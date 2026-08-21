import { createHash } from "node:crypto";

import YAML from "yaml";

/**
 * ContractCourt — deterministic OpenAPI/Swagger contract comparison.
 *
 * Compares a "before" and an "after" OpenAPI 3.x (or Swagger 2.0) document and
 * emits a stable, ordered list of findings, each classified as breaking,
 * additive, or ambiguous, plus an aggregated verdict:
 *
 * - breaking → verdict "block": removed operations; newly required parameters
 *   (explicit `required: true` or implicit path parameters); newly required
 *   request-body fields (added with `required: true` or newly listed in the
 *   `required` array); incompatible type changes (both sides typed, types
 *   differ); removed enum values, and enum constraints added to previously
 *   unconstrained values (they exclude values the old spec accepted); removed
 *   2xx success responses.
 * - additive → verdict stays "pass": added operations; added optional
 *   parameters/fields; relaxed constraints (required→optional, enum values or
 *   the enum constraint itself removed); added 2xx responses.
 * - ambiguous → verdict "warn": removed parameters and request fields
 *   (consumers may still send them); format-only changes (int32→int64);
 *   one-sided type changes (untyped→typed). Honest titles, never silently
 *   upgraded to breaking.
 *
 * Doc-only edits (description, summary, title, example/examples) are never
 * compared and so never produce findings.
 *
 * MVP limitations (deliberate — see docs/superpowers/plans/
 * 2026-07-28-quorate-convoke-local-candidate.md Task 4.2):
 * - Request bodies: only `requestBody.content["application/json"].schema` is
 *   analyzed (a media-type key of `application/json; …` is accepted), and only
 *   object `properties` ONE nesting level deep (`body.address.street`).
 *   `allOf`/`anyOf`/`oneOf` are not expanded. Local `#/…` `$ref` pointers are
 *   resolved (cycle- and depth-guarded, `array.items` unwrapped); external
 *   (`http://`/`file`) refs stay unresolved and compare as untyped.
 * - Response body fields (every documented status, `application/json` content
 *   or the Swagger 2.0 `schema` shorthand) are compared for type/format/enum
 *   drift only — response field additions, removals, and required-flag flips
 *   are not classified. Response objects may themselves be `#/components/
 *   responses/…` refs; those are resolved too.
 * - Swagger 2.0 `in: body` parameters are compared as plain parameters (name/
 *   required/type), not mapped onto the request-body field analysis.
 * - `default` responses, deprecation flags, and non-2xx status add/remove are
 *   not compared (only their body schemas, per the response bullet above).
 * - `compareContracts` throws (never returns a partial result) when either
 *   side fails OpenAPI parsing; use `parseOpenApi` directly for a
 *   non-throwing validity check.
 *
 * Fingerprints mimic identity.ts: sha256 over canonical JSON (object keys
 * sorted recursively), truncated to 16 hex chars. The fingerprinted payload is
 * `{rule, method?, path?, detail}` where `detail` is built from sorted,
 * order-insensitive evidence, so re-serializing a document with reordered keys
 * or `required`/enum arrays never changes an id. Findings are sorted by path,
 * method, rule, then id, so identical inputs always produce a byte-identical
 * findings array.
 */

export type ContractChangeType = "breaking" | "additive" | "ambiguous";

export type ContractVerdict = "pass" | "warn" | "block";

export interface ContractFinding {
  /** Stable 16-hex fingerprint: sha256 over canonical JSON of {rule, method?, path?, detail}. */
  id: string;
  changeType: ContractChangeType;
  /** Kebab rule id, e.g. "operation-removed", "request-field-became-required". */
  rule: string;
  title: string;
  /** Concrete evidence with before→after values. */
  body: string;
  /** Fixed mapping: breaking→"high", ambiguous→"medium", additive→"info". */
  severity: "critical" | "high" | "medium" | "low" | "info";
  /** Uppercase HTTP method when operation-scoped. */
  method?: string;
  /** OpenAPI path template when operation-scoped. */
  path?: string;
}

export interface ContractSide {
  label: string;
  /** sha256 hex of the raw source text. */
  hash: string;
}

export interface ContractComparisonResult {
  /** block if any breaking finding, warn if any ambiguous, else pass. */
  verdict: ContractVerdict;
  counts: { breaking: number; ambiguous: number; additive: number };
  before: ContractSide;
  after: ContractSide;
  findings: ContractFinding[];
}

type JsonRecord = Record<string, unknown>;

const HTTP_METHODS = ["delete", "get", "head", "options", "patch", "post", "put", "trace"] as const;
const ID_HEX = 16;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Canonical JSON: JSON with object keys sorted recursively, so member order never matters. */
function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson((value as JsonRecord)[key])}`).join(",")}}`;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Plain code-unit comparison (never localeCompare) so ordering is byte-stable everywhere. */
function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fingerprint(rule: string, scope: { method?: string; path?: string }, detail: string): string {
  const payload: JsonRecord = { rule, detail };
  if (scope.method !== undefined) payload.method = scope.method;
  if (scope.path !== undefined) payload.path = scope.path;
  return sha256Hex(canonicalJson(payload)).slice(0, ID_HEX);
}

function severityFor(changeType: ContractChangeType): ContractFinding["severity"] {
  return changeType === "breaking" ? "high" : changeType === "ambiguous" ? "medium" : "info";
}

function pushFinding(
  findings: ContractFinding[],
  changeType: ContractChangeType,
  rule: string,
  title: string,
  body: string,
  detail: string,
  scope: { method: string; path: string }
): void {
  findings.push({
    id: fingerprint(rule, scope, detail),
    changeType,
    rule,
    title,
    body,
    severity: severityFor(changeType),
    method: scope.method,
    path: scope.path
  });
}

/**
 * Parse an OpenAPI 3.x or Swagger 2.0 document from JSON or YAML text.
 * Detection: a trimmed source starting with `{` is parsed as JSON, anything
 * else as YAML (YAML is a JSON superset). Validates the minimal shape — a
 * top-level object with a string `openapi` or `swagger` version and a `paths`
 * object — and NEVER throws: bad input comes back as `{ok: false, error}`.
 */
export function parseOpenApi(source: string): { ok: true; doc: unknown } | { ok: false; error: string } {
  if (typeof source !== "string" || source.trim().length === 0) {
    return { ok: false, error: "Empty source: expected a non-empty OpenAPI/Swagger document." };
  }
  const trimmed = source.trim();
  let parsed: unknown;
  if (trimmed.startsWith("{")) {
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      return { ok: false, error: `Invalid JSON: ${(error as Error).message}` };
    }
  } else {
    try {
      parsed = YAML.parse(trimmed, { merge: true });
    } catch (error) {
      return { ok: false, error: `Invalid YAML: ${(error as Error).message}` };
    }
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: 'Not an OpenAPI document: expected a top-level object.' };
  }
  const version = parsed.openapi ?? parsed.swagger;
  if (typeof version !== "string" || version.length === 0) {
    return {
      ok: false,
      error: 'Not an OpenAPI document: expected a string "openapi" (3.x) or "swagger" (2.0) version.'
    };
  }
  if (!isRecord(parsed.paths)) {
    return { ok: false, error: 'Not an OpenAPI document: expected "paths" to be an object.' };
  }
  return { ok: true, doc: parsed };
}

/**
 * Compare two OpenAPI/Swagger documents and return the aggregated verdict,
 * per-change-type counts, per-side identities (label + sha256 of the raw
 * source), and the deterministically ordered findings.
 *
 * Throws an Error when either side fails `parseOpenApi` — there is no honest
 * comparison to run against a non-document, and callers gate on the exception
 * rather than a malformed result.
 */
export function compareContracts(input: {
  before: { source: string; label: string };
  after: { source: string; label: string };
}): ContractComparisonResult {
  const before = parseOpenApi(input.before.source);
  if (!before.ok) {
    throw new Error(
      `Cannot compare contracts: before ("${input.before.label}") is not a valid OpenAPI document: ${before.error}`
    );
  }
  const after = parseOpenApi(input.after.source);
  if (!after.ok) {
    throw new Error(
      `Cannot compare contracts: after ("${input.after.label}") is not a valid OpenAPI document: ${after.error}`
    );
  }

  const findings: ContractFinding[] = [];
  compareOperations(findings, collectOperations(before.doc), collectOperations(after.doc));
  findings.sort(
    (left, right) =>
      compareStrings(left.path ?? "", right.path ?? "") ||
      compareStrings(left.method ?? "", right.method ?? "") ||
      compareStrings(left.rule, right.rule) ||
      compareStrings(left.id, right.id)
  );

  const counts = { breaking: 0, ambiguous: 0, additive: 0 };
  for (const finding of findings) counts[finding.changeType] += 1;
  const verdict: ContractVerdict =
    counts.breaking > 0 ? "block" : counts.ambiguous > 0 ? "warn" : "pass";

  return {
    verdict,
    counts,
    before: { label: input.before.label, hash: sha256Hex(input.before.source) },
    after: { label: input.after.label, hash: sha256Hex(input.after.source) },
    findings
  };
}

/** The subset of JSON-Schema facets ContractCourt reasons about. */
interface SchemaView {
  /** Normalized `type` (a type array becomes a sorted "|"-join); undefined = untyped. */
  type?: string;
  format?: string;
  /** Enum values as sorted canonical-JSON strings, so comparison is order-insensitive. */
  enumValues?: string[];
}

interface ParameterView extends SchemaView {
  /** `${in}:${name}` — stable identity independent of list order. */
  key: string;
  in: string;
  name: string;
  required: boolean;
}

interface FieldView extends SchemaView {
  required: boolean;
}

interface OperationView {
  method: string;
  path: string;
  parameters: Map<string, ParameterView>;
  fields: Map<string, FieldView>;
  /** Response body fields per status code (only statuses present on both sides are compared). */
  responseFields: Map<string, Map<string, FieldView>>;
  successResponses: Set<string>;
}

function normalizeType(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const types = value.filter((entry): entry is string => typeof entry === "string").sort();
    if (types.length > 0) return types.join("|");
  }
  return undefined;
}

function normalizeFormat(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeEnum(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((entry) => canonicalJson(entry)).sort(compareStrings);
}

/**
 * Read the compared facets from a schema holder. OpenAPI 3 puts them on
 * `schema`; Swagger 2 puts them inline on the parameter — accept both.
 */
function schemaView(holder: JsonRecord): SchemaView {
  const schema = isRecord(holder.schema) ? (holder.schema as JsonRecord) : holder;
  return {
    type: normalizeType(schema.type),
    format: normalizeFormat(schema.format),
    enumValues: normalizeEnum(schema.enum)
  };
}

/** Top-level properties live at depth 0; one nested object level (`a.b`) at depth 1. */
const MAX_FIELD_DEPTH = 1;
const MAX_REF_CHAIN = 10;
const MAX_ARRAY_UNWRAP = 4;

/** Resolve local `#/…` JSON pointers within the same document; anything else (external/unresolvable) stays as-is. */
function resolveRef(doc: JsonRecord, schema: unknown, seen: Set<string> = new Set()): unknown {
  if (!isRecord(schema)) return schema;
  const ref = schema.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/")) return schema;
  if (seen.has(ref) || seen.size >= MAX_REF_CHAIN) return schema;
  seen.add(ref);
  const segments = ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  let target: unknown = doc;
  for (const segment of segments) {
    if (!isRecord(target)) return schema;
    target = target[segment];
  }
  return resolveRef(doc, target, seen);
}

/** Array schemas carry their item fields: unwrap `array of X` so it compares as X (bounded). */
function effectiveSchema(doc: JsonRecord, schema: unknown): unknown {
  let current = resolveRef(doc, schema);
  let unwraps = 0;
  while (
    unwraps < MAX_ARRAY_UNWRAP &&
    isRecord(current) &&
    normalizeType(current.type) === "array" &&
    isRecord(current.items)
  ) {
    current = resolveRef(doc, current.items);
    unwraps += 1;
  }
  return current;
}

function collectFields(schema: unknown, prefix: string, depth: number, out: Map<string, FieldView>, doc: JsonRecord): void {
  const effective = effectiveSchema(doc, schema);
  if (!isRecord(effective) || !isRecord(effective.properties) || depth > MAX_FIELD_DEPTH) return;
  const required = new Set(
    Array.isArray(effective.required)
      ? effective.required.filter((entry): entry is string => typeof entry === "string")
      : []
  );
  const properties = effective.properties as JsonRecord;
  for (const name of Object.keys(properties).sort(compareStrings)) {
    const node = effectiveSchema(doc, properties[name]);
    if (!isRecord(node)) continue;
    out.set(`${prefix}${name}`, { ...schemaView(node), required: required.has(name) });
    if (depth < MAX_FIELD_DEPTH && isRecord(node.properties)) {
      collectFields(node, `${prefix}${name}.`, depth + 1, out, doc);
    }
  }
}

function collectRequestFields(requestBody: unknown, doc: JsonRecord): Map<string, FieldView> {
  const fields = new Map<string, FieldView>();
  if (!isRecord(requestBody) || !isRecord(requestBody.content)) return fields;
  const content = requestBody.content as JsonRecord;
  const sortedKeys = Object.keys(content).sort(compareStrings);
  const mediaKey = sortedKeys.includes("application/json")
    ? "application/json"
    : sortedKeys.find((key) => key.startsWith("application/json;"));
  if (mediaKey === undefined) return fields;
  const media = content[mediaKey];
  if (!isRecord(media)) return fields;
  collectFields(media.schema, "", 0, fields, doc);
  return fields;
}

/** Response body fields per status code — resolved through `#/components/responses/…` refs. */
function collectResponseFields(responses: unknown, doc: JsonRecord): Map<string, Map<string, FieldView>> {
  const byStatus = new Map<string, Map<string, FieldView>>();
  if (!isRecord(responses)) return byStatus;
  for (const status of Object.keys(responses).sort(compareStrings)) {
    const response = resolveRef(doc, responses[status]);
    if (!isRecord(response)) continue;
    const fields = new Map<string, FieldView>();
    let schema: unknown;
    if (isRecord(response.content)) {
      const content = response.content as JsonRecord;
      const sortedKeys = Object.keys(content).sort(compareStrings);
      const mediaKey = sortedKeys.includes("application/json")
        ? "application/json"
        : sortedKeys.find((key) => key.startsWith("application/json;"));
      if (mediaKey !== undefined && isRecord(content[mediaKey])) schema = (content[mediaKey] as JsonRecord).schema;
    } else {
      schema = response.schema; // Swagger 2.0 shorthand
    }
    collectFields(schema, "", 0, fields, doc);
    if (fields.size > 0) byStatus.set(status, fields);
  }
  return byStatus;
}

function parseParameters(raw: unknown, doc: JsonRecord): ParameterView[] {
  if (!Array.isArray(raw)) return [];
  const views: ParameterView[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.in !== "string") continue;
    // OAS 3 non-body parameters may point their schema at a shared component.
    const holder: JsonRecord = isRecord(entry.schema) ? { ...entry, schema: resolveRef(doc, entry.schema) } : entry;
    views.push({
      ...schemaView(holder),
      key: `${entry.in}:${entry.name}`,
      in: entry.in,
      name: entry.name,
      // Path parameters are required by the OpenAPI spec even when omitted.
      required: entry.required === true || entry.in === "path"
    });
  }
  return views;
}

function collectSuccessResponses(responses: unknown): Set<string> {
  const success = new Set<string>();
  if (!isRecord(responses)) return success;
  for (const key of Object.keys(responses)) {
    if (/^2\d{2}$/.test(key)) success.add(key);
  }
  return success;
}

/** Flatten a document into operation views keyed by JSON.stringify([method, path]). */
function collectOperations(doc: unknown): Map<string, OperationView> {
  const operations = new Map<string, OperationView>();
  if (!isRecord(doc)) return operations;
  const document = doc as JsonRecord;
  const paths = isRecord(document.paths) ? (document.paths as JsonRecord) : {};
  for (const path of Object.keys(paths)) {
    const pathItem = paths[path];
    if (!isRecord(pathItem)) continue;
    const pathLevelParameters = parseParameters(pathItem.parameters, document);
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!isRecord(operation)) continue;
      const parameters = new Map<string, ParameterView>();
      for (const parameter of pathLevelParameters) parameters.set(parameter.key, parameter);
      // Operation-level parameters override same in:name path-level ones.
      for (const parameter of parseParameters(operation.parameters, document)) parameters.set(parameter.key, parameter);
      const upper = method.toUpperCase();
      operations.set(JSON.stringify([upper, path]), {
        method: upper,
        path,
        parameters,
        fields: collectRequestFields(operation.requestBody, document),
        responseFields: collectResponseFields(operation.responses, document),
        successResponses: collectSuccessResponses(operation.responses)
      });
    }
  }
  return operations;
}

function parameterLabel(parameter: ParameterView): string {
  const location = parameter.in.charAt(0).toUpperCase() + parameter.in.slice(1);
  return `${location} parameter "${parameter.name}"`;
}

function compareEnums(
  findings: ContractFinding[],
  scope: { method: string; path: string },
  label: string,
  detailKey: string,
  beforeValues: string[] | undefined,
  afterValues: string[] | undefined
): void {
  if (beforeValues === undefined && afterValues === undefined) return;
  if (beforeValues === undefined || afterValues === undefined) {
    if (beforeValues !== undefined) {
      pushFinding(
        findings,
        "additive",
        "enum-constraint-removed",
        "Enum constraint removed",
        `${label} lost its enum constraint (before: [${beforeValues.join(", ")}]; after: unconstrained).`,
        `${detailKey} enum constraint removed`,
        scope
      );
    } else if (afterValues !== undefined) {
      pushFinding(
        findings,
        "breaking",
        "enum-constraint-added",
        "Enum constraint added",
        `${label} gained an enum constraint (before: unconstrained; after: [${afterValues.join(", ")}]). Previously accepted values may now be rejected.`,
        `${detailKey} enum constraint added ${canonicalJson(afterValues)}`,
        scope
      );
    }
    return;
  }
  const removed = beforeValues.filter((value) => !afterValues.includes(value));
  const added = afterValues.filter((value) => !beforeValues.includes(value));
  if (removed.length > 0) {
    pushFinding(
      findings,
      "breaking",
      "enum-value-removed",
      "Enum value removed",
      `${label} no longer accepts enum value(s) (before: [${beforeValues.join(", ")}]; after: [${afterValues.join(", ")}]; removed: ${removed.join(", ")}). Requests sending a removed value will be rejected.`,
      `${detailKey} enum removed ${canonicalJson(removed)}`,
      scope
    );
  }
  if (added.length > 0) {
    pushFinding(
      findings,
      "additive",
      "enum-value-added",
      "Enum value added",
      `${label} now accepts additional enum value(s) (before: [${beforeValues.join(", ")}]; after: [${afterValues.join(", ")}]; added: ${added.join(", ")}).`,
      `${detailKey} enum added ${canonicalJson(added)}`,
      scope
    );
  }
}

/**
 * Type/format/enum comparison shared by parameters and request fields. A type
 * change (breaking when both sides are typed, ambiguous when one-sided) subsumes
 * format and enum noise; format-only changes are honestly ambiguous.
 */
function compareTypeFormatEnum(
  findings: ContractFinding[],
  scope: { method: string; path: string },
  label: string,
  detailKey: string,
  before: SchemaView,
  after: SchemaView
): void {
  if (before.type !== after.type) {
    const incompatible = before.type !== undefined && after.type !== undefined;
    pushFinding(
      findings,
      incompatible ? "breaking" : "ambiguous",
      "type-changed",
      "Type changed",
      incompatible
        ? `${label} changed type (before: ${before.type}; after: ${after.type}). Values of the old type will fail validation.`
        : `${label} changed type (before: ${before.type ?? "untyped"}; after: ${after.type ?? "untyped"}). The new constraint may reject values the old spec allowed.`,
      `${detailKey} type ${before.type ?? "untyped"}->${after.type ?? "untyped"}`,
      scope
    );
    return;
  }
  if (before.format !== after.format) {
    pushFinding(
      findings,
      "ambiguous",
      "format-changed",
      "Format changed",
      `${label} changed format (before: ${before.format ?? "none"}; after: ${after.format ?? "none"}). Compatibility impact is uncertain.`,
      `${detailKey} format ${before.format ?? "none"}->${after.format ?? "none"}`,
      scope
    );
    return;
  }
  compareEnums(findings, scope, label, detailKey, before.enumValues, after.enumValues);
}

function compareParameters(
  findings: ContractFinding[],
  scope: { method: string; path: string },
  before: Map<string, ParameterView>,
  after: Map<string, ParameterView>
): void {
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort(compareStrings)) {
    const beforeParameter = before.get(key);
    const afterParameter = after.get(key);
    const detailKey = `parameter ${key}`;
    if (beforeParameter === undefined && afterParameter !== undefined) {
      const label = parameterLabel(afterParameter);
      if (afterParameter.required) {
        pushFinding(
          findings,
          "breaking",
          "required-parameter-added",
          "Required parameter added",
          `${label} was added as required (before: absent; after: required). Requests without it will be rejected.`,
          `${detailKey} added required=true`,
          scope
        );
      } else {
        pushFinding(
          findings,
          "additive",
          "optional-parameter-added",
          "Optional parameter added",
          `${label} was added as optional (before: absent; after: optional).`,
          `${detailKey} added required=false`,
          scope
        );
      }
      continue;
    }
    if (afterParameter === undefined && beforeParameter !== undefined) {
      pushFinding(
        findings,
        "ambiguous",
        "parameter-removed",
        "Parameter removed",
        `${parameterLabel(beforeParameter)} was removed (before: present; after: absent). Consumers may still send it; the server should tolerate it.`,
        `${detailKey} removed`,
        scope
      );
      continue;
    }
    if (beforeParameter === undefined || afterParameter === undefined) continue;
    const label = parameterLabel(afterParameter);
    if (!beforeParameter.required && afterParameter.required) {
      pushFinding(
        findings,
        "breaking",
        "parameter-became-required",
        "Parameter became required",
        `${label} became required (before: required=false; after: required=true). Requests without it will now be rejected.`,
        `${detailKey} required false->true`,
        scope
      );
    } else if (beforeParameter.required && !afterParameter.required) {
      pushFinding(
        findings,
        "additive",
        "parameter-became-optional",
        "Parameter became optional",
        `${label} became optional (before: required=true; after: required=false).`,
        `${detailKey} required true->false`,
        scope
      );
    }
    compareTypeFormatEnum(findings, scope, label, detailKey, beforeParameter, afterParameter);
  }
}

function compareRequestFields(
  findings: ContractFinding[],
  scope: { method: string; path: string },
  before: Map<string, FieldView>,
  after: Map<string, FieldView>
): void {
  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort(compareStrings)) {
    const beforeField = before.get(name);
    const afterField = after.get(name);
    const detailKey = `request body field ${name}`;
    const label = `Request body field "${name}"`;
    if (beforeField === undefined && afterField !== undefined) {
      if (afterField.required) {
        pushFinding(
          findings,
          "breaking",
          "required-request-field-added",
          "Required request field added",
          `${label} was added as required (before: absent; after: required). Requests without it will be rejected.`,
          `${detailKey} added required=true`,
          scope
        );
      } else {
        pushFinding(
          findings,
          "additive",
          "optional-request-field-added",
          "Optional request field added",
          `${label} was added as optional (before: absent; after: optional).`,
          `${detailKey} added required=false`,
          scope
        );
      }
      continue;
    }
    if (afterField === undefined && beforeField !== undefined) {
      pushFinding(
        findings,
        "ambiguous",
        "request-field-removed",
        "Request field removed",
        `${label} was removed (before: present; after: absent). Consumers may still send it; strict servers may reject it.`,
        `${detailKey} removed`,
        scope
      );
      continue;
    }
    if (beforeField === undefined || afterField === undefined) continue;
    if (!beforeField.required && afterField.required) {
      pushFinding(
        findings,
        "breaking",
        "request-field-became-required",
        "Request field became required",
        `${label} became required (before: required=false; after: required=true). Requests without it will now be rejected.`,
        `${detailKey} required false->true`,
        scope
      );
    } else if (beforeField.required && !afterField.required) {
      pushFinding(
        findings,
        "additive",
        "request-field-became-optional",
        "Request field became optional",
        `${label} became optional (before: required=true; after: required=false).`,
        `${detailKey} required true->false`,
        scope
      );
    }
    compareTypeFormatEnum(findings, scope, label, detailKey, beforeField, afterField);
  }
}

function compareResponses(
  findings: ContractFinding[],
  scope: { method: string; path: string },
  before: Set<string>,
  after: Set<string>
): void {
  for (const status of [...before].filter((value) => !after.has(value)).sort(compareStrings)) {
    pushFinding(
      findings,
      "breaking",
      "success-response-removed",
      "Success response removed",
      `Response ${status} was removed (before: present; after: absent). Consumers relying on the ${status} success response will break.`,
      `response ${status} removed`,
      scope
    );
  }
  for (const status of [...after].filter((value) => !before.has(value)).sort(compareStrings)) {
    pushFinding(
      findings,
      "additive",
      "success-response-added",
      "Success response added",
      `Response ${status} was added (before: absent; after: present).`,
      `response ${status} added`,
      scope
    );
  }
}

/**
 * Response body fields are compared for type/format/enum drift only. Additions,
 * removals, and required-flag flips of response fields are deliberately not
 * classified (the spec's required rules are request-scoped; a response field
 * the server stops sending is covered by the schema evidence, not the gate).
 */
function compareResponseFields(
  findings: ContractFinding[],
  scope: { method: string; path: string },
  before: Map<string, Map<string, FieldView>>,
  after: Map<string, Map<string, FieldView>>
): void {
  for (const status of [...before.keys()].filter((value) => after.has(value)).sort(compareStrings)) {
    const beforeFields = before.get(status)!;
    const afterFields = after.get(status)!;
    for (const name of [...new Set([...beforeFields.keys(), ...afterFields.keys()])].sort(compareStrings)) {
      const beforeField = beforeFields.get(name);
      const afterField = afterFields.get(name);
      if (beforeField === undefined || afterField === undefined) continue;
      compareTypeFormatEnum(
        findings,
        scope,
        `Response ${status} body field "${name}"`,
        `response ${status} body field ${name}`,
        beforeField,
        afterField
      );
    }
  }
}

function compareOperations(
  findings: ContractFinding[],
  before: Map<string, OperationView>,
  after: Map<string, OperationView>
): void {
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort(compareStrings)) {
    const beforeOperation = before.get(key);
    const afterOperation = after.get(key);
    if (beforeOperation === undefined && afterOperation !== undefined) {
      pushFinding(
        findings,
        "additive",
        "operation-added",
        "Operation added",
        `${afterOperation.method} ${afterOperation.path} was added (before: absent; after: present).`,
        "operation added",
        { method: afterOperation.method, path: afterOperation.path }
      );
      continue;
    }
    if (afterOperation === undefined && beforeOperation !== undefined) {
      pushFinding(
        findings,
        "breaking",
        "operation-removed",
        "Operation removed",
        `${beforeOperation.method} ${beforeOperation.path} was removed (before: present; after: absent). Existing consumers will break.`,
        "operation removed",
        { method: beforeOperation.method, path: beforeOperation.path }
      );
      continue;
    }
    if (beforeOperation === undefined || afterOperation === undefined) continue;
    const scope = { method: afterOperation.method, path: afterOperation.path };
    compareParameters(findings, scope, beforeOperation.parameters, afterOperation.parameters);
    compareRequestFields(findings, scope, beforeOperation.fields, afterOperation.fields);
    compareResponseFields(findings, scope, beforeOperation.responseFields, afterOperation.responseFields);
    compareResponses(findings, scope, beforeOperation.successResponses, afterOperation.successResponses);
  }
}
