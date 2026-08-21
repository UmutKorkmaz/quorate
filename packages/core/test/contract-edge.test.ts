import { describe, expect, it } from "vitest";
import { compareContracts, parseOpenApi } from "../src/contract.js";

/**
 * Adversarial edge tests for the ContractCourt engine (packages/core/src/contract.ts).
 *
 * These tests are written against the SPEC, not the implementation:
 *   - parseOpenApi(source) -> { ok: true; doc } | { ok: false; error }
 *   - compareContracts({ before: {source,label}, after: {source,label} })
 *       -> { verdict, counts, before, after, findings }
 *   - severity map: breaking -> high, ambiguous -> medium, additive -> info
 *   - verdict: block iff breaking > 0; else warn iff ambiguous > 0; else pass
 *   - deterministic output (ids and order) for identical logical input
 */

type Json = Record<string, unknown>;

interface Finding {
  id: string;
  changeType: "breaking" | "additive" | "ambiguous";
  rule: string;
  title: string;
  body: string;
  severity: string;
  method?: string;
  path?: string;
}

interface Result {
  verdict: "pass" | "warn" | "block";
  counts: { breaking: number; additive: number; ambiguous: number };
  before: { label: string; hash: string };
  after: { label: string; hash: string };
  findings: Finding[];
}

const ID_16HEX = /^[0-9a-f]{16}$/;
const SEVERITY_BY_CHANGE: Record<Finding["changeType"], string> = {
  breaking: "high",
  ambiguous: "medium",
  additive: "info"
};

/** Assert the full documented result contract on every comparison made in this file. */
function expectValidResult(r: Result, labels: [string, string]): Result {
  expect(r).toBeTruthy();
  expect(["pass", "warn", "block"]).toContain(r.verdict);

  // before/after identity blocks
  expect(typeof r.before?.label).toBe("string");
  expect(r.before.label).toBe(labels[0]);
  expect(typeof r.before?.hash).toBe("string");
  expect((r.before.hash as string).length).toBeGreaterThan(0);
  expect(typeof r.after?.label).toBe("string");
  expect(r.after.label).toBe(labels[1]);
  expect(typeof r.after?.hash).toBe("string");
  expect((r.after.hash as string).length).toBeGreaterThan(0);

  // findings shape
  expect(Array.isArray(r.findings)).toBe(true);
  const ids = new Set<string>();
  for (const f of r.findings as Finding[]) {
    expect(typeof f.id).toBe("string");
    expect(f.id).toMatch(ID_16HEX);
    expect(ids.has(f.id)).toBe(false); // no duplicate findings for the same op/change
    ids.add(f.id);
    expect(["breaking", "additive", "ambiguous"]).toContain(f.changeType);
    expect(f.severity).toBe(SEVERITY_BY_CHANGE[f.changeType]);
    expect(typeof f.rule).toBe("string");
    expect((f.rule as string).length).toBeGreaterThan(0);
    expect(typeof f.title).toBe("string");
    expect((f.title as string).length).toBeGreaterThan(0);
    expect(typeof f.body).toBe("string");
    expect((f.body as string).length).toBeGreaterThan(0);
    if (f.method !== undefined) expect(typeof f.method).toBe("string");
    if (f.path !== undefined) expect(typeof f.path).toBe("string");
  }

  // counts must tally with findings
  expect(r.counts).toBeTruthy();
  expect(typeof r.counts.breaking).toBe("number");
  expect(typeof r.counts.ambiguous).toBe("number");
  expect(typeof r.counts.additive).toBe("number");
  const tally = { breaking: 0, ambiguous: 0, additive: 0 } as Record<Finding["changeType"], number>;
  for (const f of r.findings as Finding[]) tally[f.changeType] += 1;
  expect(r.counts.breaking).toBe(tally.breaking);
  expect(r.counts.ambiguous).toBe(tally.ambiguous);
  expect(r.counts.additive).toBe(tally.additive);

  // verdict derivation: block iff breaking; else warn iff ambiguous; else pass
  const expectedVerdict = tally.breaking > 0 ? "block" : tally.ambiguous > 0 ? "warn" : "pass";
  expect(r.verdict).toBe(expectedVerdict);
  return r;
}

/** Compare two JSON docs (as JSON text) with full result validation. */
function cmp(before: Json, after: Json, labels: [string, string] = ["base", "head"]): Result {
  return expectValidResult(
    compareContracts({
      before: { source: JSON.stringify(before), label: labels[0] },
      after: { source: JSON.stringify(after), label: labels[1] }
    }) as Result,
    labels
  );
}

/** Compare two raw source strings with full result validation. */
function cmpRaw(before: string, after: string, labels: [string, string] = ["base", "head"]): Result {
  return expectValidResult(
    compareContracts({ before: { source: before, label: labels[0] }, after: { source: after, label: labels[1] } }) as Result,
    labels
  );
}

function openApiDoc(paths: Json, info: Json = { title: "Tasks API", version: "1.0.0" }): Json {
  return { openapi: "3.0.3", info, paths };
}

const clone = (v: Json): Json => JSON.parse(JSON.stringify(v)) as Json;

// ---------------------------------------------------------------------------
// Group 1: empty / absent paths
// ---------------------------------------------------------------------------

describe("contract edge: empty and absent paths", () => {
  it("paths:{} on both sides -> pass with zero findings", () => {
    const r = cmp(openApiDoc({}), openApiDoc({}));
    expect(r.verdict).toBe("pass");
    expect(r.findings).toHaveLength(0);
    expect(r.counts).toEqual({ breaking: 0, ambiguous: 0, additive: 0 });
  });

  it("empty before + populated after -> additive-only, verdict stays pass", () => {
    const after = openApiDoc({
      "/tasks": {
        get: {
          summary: "List tasks",
          responses: { "200": { description: "OK" } }
        }
      }
    });
    const r = cmp(openApiDoc({}), after);
    expect(r.verdict).toBe("pass"); // additive never blocks or warns
    expect(r.counts.breaking).toBe(0);
    expect(r.counts.ambiguous).toBe(0);
    expect(r.counts.additive).toBeGreaterThan(0);
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings.every((f) => f.changeType === "additive")).toBe(true);
    expect(r.findings.every((f) => f.severity === "info")).toBe(true);
  });

  it("absent paths key on both sides: never a throw; zero findings if parsed", () => {
    const noPaths = { openapi: "3.0.3", info: { title: "T", version: "1" } };
    const src = JSON.stringify(noPaths);
    const a = parseOpenApi(src);
    const b = parseOpenApi(src);
    expect(() => parseOpenApi(src)).not.toThrow();
    if (a.ok && b.ok) {
      const r = cmpRaw(src, src);
      expect(r.verdict).toBe("pass");
      expect(r.findings).toHaveLength(0);
    } else {
      // failing closed on a paths-less doc is acceptable strictness; error must be a non-empty string
      expect(a.ok).toBe(false);
      if (!a.ok) expect(a.error.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Group 2: Swagger 2.0 tolerance
// ---------------------------------------------------------------------------

const swagger2 = {
  swagger: "2.0",
  info: { title: "Petstore (swagger 2.0)", version: "1.0.0" },
  paths: {
    "/pets": {
      get: {
        summary: "List pets",
        responses: {
          "200": {
            description: "OK",
            schema: { type: "array", items: { $ref: "#/definitions/Pet" } }
          }
        }
      },
      post: {
        summary: "Create pet",
        parameters: [
          { name: "body", in: "body", schema: { $ref: "#/definitions/Pet" } }
        ],
        responses: { "201": { description: "Created" } }
      }
    }
  },
  definitions: {
    Pet: { type: "object", required: ["name"], properties: { name: { type: "string" } } }
  }
};

describe("contract edge: swagger 2.0 documents", () => {
  it("parses a swagger 2.0 doc with ok:true and an object doc", () => {
    const r = parseOpenApi(JSON.stringify(swagger2));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc).toBeTruthy();
      expect(typeof r.doc).toBe("object");
    }
  });

  it("identical swagger 2.0 docs compare to pass with zero findings, no throw", () => {
    const src = JSON.stringify(swagger2);
    expect(() => cmpRaw(src, src)).not.toThrow();
    const r = cmpRaw(src, src);
    expect(r.verdict).toBe("pass");
    expect(r.findings).toHaveLength(0);
  });

  it("swagger 2.0 with a removed operation compares without crashing and yields a valid verdict", () => {
    const after = clone(swagger2 as unknown as Json);
    delete (after.paths as Json)["/pets"].post;
    expect(() => cmp(swagger2 as unknown as Json, after)).not.toThrow();
    const r = cmp(swagger2 as unknown as Json, after);
    expect(["pass", "warn", "block"]).toContain(r.verdict);
    expect(r.findings).toHaveLength(r.counts.breaking + r.counts.ambiguous + r.counts.additive);
  });
});

// ---------------------------------------------------------------------------
// Group 3: JSON input and YAML anchors / merge keys
// ---------------------------------------------------------------------------

const anchoredYaml = `openapi: 3.0.3
info:
  title: Anchor API
  version: 1.0.0
paths:
  /a:
    get: &listA
      summary: List a
      responses:
        "200":
          description: OK
  /b:
    get: *listA
`;

const expandedYamlSameOrder = `openapi: 3.0.3
info:
  title: Anchor API
  version: 1.0.0
paths:
  /a:
    get:
      summary: List a
      responses:
        "200":
          description: OK
  /b:
    get:
      summary: List a
      responses:
        "200":
          description: OK
`;

const mergeKeyYaml = `openapi: 3.0.3
info:
  title: Merge API
  version: 1.0.0
paths:
  /a:
    get: &baseOp
      summary: Base op
      responses:
        "200":
          description: OK
  /b:
    get:
      <<: *baseOp
      summary: B op
`;

const mergeKeyExpanded = `openapi: 3.0.3
info:
  title: Merge API
  version: 1.0.0
paths:
  /a:
    get:
      summary: Base op
      responses:
        "200":
          description: OK
  /b:
    get:
      summary: B op
      responses:
        "200":
          description: OK
`;

describe("contract edge: JSON input and YAML anchors/merge keys", () => {
  it("parses an OpenAPI document supplied as a JSON string", () => {
    const doc = openApiDoc({ "/tasks": { get: { summary: "List", responses: { "200": { description: "OK" } } } } });
    const r = parseOpenApi(JSON.stringify(doc));
    expect(r.ok).toBe(true);
    if (r.ok) expect(typeof r.doc).toBe("object");
  });

  it("YAML with anchors and aliases parses ok and never throws", () => {
    expect(() => parseOpenApi(anchoredYaml)).not.toThrow();
    const r = parseOpenApi(anchoredYaml);
    expect(r.ok).toBe(true);
  });

  it("alias-anchored YAML vs its expanded equivalent -> logically identical -> zero findings", () => {
    expect(() => cmpRaw(anchoredYaml, expandedYamlSameOrder)).not.toThrow();
    const r = cmpRaw(anchoredYaml, expandedYamlSameOrder);
    expect(r.verdict).toBe("pass");
    expect(r.findings).toHaveLength(0);
  });

  it("YAML with merge keys parses ok and compares against itself without findings", () => {
    expect(() => parseOpenApi(mergeKeyYaml)).not.toThrow();
    const r = parseOpenApi(mergeKeyYaml);
    expect(r.ok).toBe(true);
    const self = cmpRaw(mergeKeyYaml, mergeKeyYaml);
    expect(self.verdict).toBe("pass");
    expect(self.findings).toHaveLength(0);
  });

  it("merge-key YAML vs fully expanded equivalent -> logically identical -> zero findings", () => {
    // The `yaml` lib supports merge keys via { merge: true }. If the parser does not
    // enable merge resolution, `<<: *anchor` keeps merge content under a literal "<<"
    // key and logically identical specs surface phantom findings.
    const r = cmpRaw(mergeKeyYaml, mergeKeyExpanded);
    expect(r.findings).toHaveLength(0);
    expect(r.verdict).toBe("pass");
  });

  it("adopting merge keys with zero logical changes must not phantom-block", () => {
    // Mirror of the case above: expanded before -> merge-key after is a no-op refactor.
    // An unresolved merge key must not fabricate a removed 2xx response (breaking).
    const r = cmpRaw(mergeKeyExpanded, mergeKeyYaml);
    expect(r.findings).toHaveLength(0);
    expect(r.verdict).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Group 4: path template parameter renames
// ---------------------------------------------------------------------------

describe("contract edge: path template parameter renames", () => {
  const op = { summary: "Get task", responses: { "200": { description: "OK" } } };

  it("/tasks/{id} -> /tasks/{taskId} does not silently pass with zero findings", () => {
    const before = openApiDoc({ "/tasks/{id}": { get: op } });
    const after = openApiDoc({ "/tasks/{taskId}": { get: op } });
    const r = cmp(before, after);
    expect(r.findings.length).toBeGreaterThan(0);
    // must surface as removed+added operations (breaking present) or as ambiguous
    expect(r.findings.some((f) => f.changeType === "breaking" || f.changeType === "ambiguous")).toBe(true);
    expect(["warn", "block"]).toContain(r.verdict);
  });

  it("template rename alongside a stable path only flags the renamed path", () => {
    const health = {
      get: { summary: "Health", responses: { "200": { description: "OK" } } },
      post: { summary: "Ping", responses: { "201": { description: "Created" } } }
    };
    const before = openApiDoc({
      "/health": clone(health),
      "/tasks/{id}": { get: op }
    });
    const after = openApiDoc({
      "/health": { post: health.post, get: health.get }, // same ops, methods reordered
      "/tasks/{taskId}": { get: op }
    });
    const r = cmp(before, after);
    expect(r.findings.length).toBeGreaterThan(0);
    // every finding must be about the renamed path, none about /health
    const healthFindings = r.findings.filter(
      (f) => f.path !== undefined && !f.path.includes("tasks")
    );
    expect(healthFindings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Group 5: HTTP method key casing
// ---------------------------------------------------------------------------

describe("contract edge: method key casing (get vs GET)", () => {
  const op = { summary: "List tasks", responses: { "200": { description: "OK" } } };

  it("get vs GET: normalized or flagged, but never duplicated findings for the same op", () => {
    const before = openApiDoc({ "/tasks": { get: op } });
    const after = openApiDoc({ "/tasks": { GET: op } });
    expect(() => cmp(before, after)).not.toThrow();
    const r = cmp(before, after);
    // at most one removed + one added finding for this single operation
    expect(r.findings.length).toBeLessThanOrEqual(2);
    // any findings must reference the affected path
    for (const f of r.findings) {
      if (f.path !== undefined) expect(f.path).toBe("/tasks");
    }
  });

  it("mixed-case get vs Get with an added response: additive finding appears once", () => {
    const before = openApiDoc({
      "/tasks": { get: { summary: "List", responses: { "200": { description: "OK" } } } }
    });
    const after = openApiDoc({
      "/tasks": {
        Get: {
          summary: "List",
          responses: { "200": { description: "OK" }, "204": { description: "No content" } }
        }
      }
    });
    const r = cmp(before, after);
    const adds204 = r.findings.filter((f) => f.changeType === "additive" && JSON.stringify(f).includes("204"));
    expect(adds204.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Group 6: newly required fields (parameters and request body)
// ---------------------------------------------------------------------------

describe("contract edge: newly required fields", () => {
  function bodyOp(schema: Json): Json {
    return {
      summary: "Create task",
      requestBody: { required: true, content: { "application/json": { schema } } },
      responses: { "201": { description: "Created" } }
    };
  }

  it("existing request-body property moved into required -> exactly one breaking finding", () => {
    const before = openApiDoc({
      "/tasks": {
        post: bodyOp({
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" }, note: { type: "string" } }
        })
      }
    });
    const after = clone(before);
    const schema = ((after.paths as Json)["/tasks"] as Json).post as Json;
    ((((schema.requestBody as Json).content as Json)["application/json"] as Json).schema as Json).required = ["name", "note"];
    const r = cmp(before, after);
    expect(r.findings).toHaveLength(1); // no double-count for the same field
    expect(r.findings[0].changeType).toBe("breaking");
    expect(r.findings[0].severity).toBe("high");
    expect(r.verdict).toBe("block");
  });

  it("brand-new property introduced as required -> breaking, single breaking finding", () => {
    const before = openApiDoc({
      "/tasks": {
        post: bodyOp({
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } }
        })
      }
    });
    const after = clone(before);
    const schema = ((after.paths as Json)["/tasks"] as Json).post as Json;
    const body = (((schema.requestBody as Json).content as Json)["application/json"] as Json).schema as Json;
    (body.properties as Json).note = { type: "string" };
    body.required = ["name", "note"];
    const r = cmp(before, after);
    expect(r.verdict).toBe("block");
    expect(r.counts.breaking).toBe(1); // one field became required -> one breaking finding
    expect(r.findings.filter((f) => f.changeType === "breaking")).toHaveLength(1);
  });

  it("query parameter flipped required:false -> true -> breaking", () => {
    const before = openApiDoc({
      "/tasks": {
        get: {
          summary: "List tasks",
          parameters: [{ name: "q", in: "query", required: false, schema: { type: "string" } }],
          responses: { "200": { description: "OK" } }
        }
      }
    });
    const after = clone(before);
    const get = ((after.paths as Json)["/tasks"] as Json).get as Json;
    ((get.parameters as Json[])[0] as Json).required = true;
    const r = cmp(before, after);
    expect(r.verdict).toBe("block");
    expect(r.counts.breaking).toBeGreaterThanOrEqual(1);
    // the only diff is the required flag flip; anything not breaking is a misfire
    expect(r.findings.every((f) => f.changeType === "breaking")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 7: enum changes
// ---------------------------------------------------------------------------

describe("contract edge: enum changes", () => {
  function enumOp(enumValue: string[] | undefined): Json {
    const prop: Json = { type: "string" };
    if (enumValue !== undefined) prop.enum = enumValue;
    return {
      summary: "Create task",
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", properties: { status: prop } } } }
      },
      responses: { "201": { description: "Created" } }
    };
  }

  function docFor(enumValue: string[] | undefined): Json {
    return openApiDoc({ "/tasks": { post: enumOp(enumValue) } });
  }

  it("enum value removed -> breaking, verdict block", () => {
    const r = cmp(docFor(["open", "closed", "archived"]), docFor(["open", "closed"]));
    expect(r.verdict).toBe("block");
    expect(r.counts.breaking).toBeGreaterThanOrEqual(1);
    expect(r.findings.filter((f) => f.changeType === "breaking").length).toBeGreaterThanOrEqual(1);
  });

  it("enum value added -> additive, verdict pass, no breaking", () => {
    const r = cmp(docFor(["open", "closed"]), docFor(["open", "closed", "archived"]));
    expect(r.verdict).toBe("pass");
    expect(r.counts.breaking).toBe(0);
    expect(r.counts.ambiguous).toBe(0);
    expect(r.counts.additive).toBeGreaterThanOrEqual(1);
    expect(r.findings.every((f) => f.changeType === "additive")).toBe(true);
  });

  it("enum introduced where none existed -> breaking or ambiguous, never additive, never silent", () => {
    const r = cmp(docFor(undefined), docFor(["a", "b"]));
    expect(r.findings.length).toBeGreaterThan(0); // not silent
    expect(r.findings.some((f) => f.changeType === "breaking" || f.changeType === "ambiguous")).toBe(true);
    expect(r.findings.some((f) => f.changeType === "additive")).toBe(false); // not dishonestly additive
    expect(["warn", "block"]).toContain(r.verdict);
  });
});

// ---------------------------------------------------------------------------
// Group 8: 2xx response changes
// ---------------------------------------------------------------------------

describe("contract edge: 2xx response changes", () => {
  it("200 removed while default still describes success -> still breaking", () => {
    const before = openApiDoc({
      "/tasks": {
        get: {
          summary: "List tasks",
          responses: {
            "200": { description: "Task list" },
            "404": { description: "Not found" },
            default: { description: "Successful or error response" }
          }
        }
      }
    });
    const after = clone(before);
    const get = ((after.paths as Json)["/tasks"] as Json).get as Json;
    delete (get.responses as Json)["200"];
    const r = cmp(before, after);
    expect(r.verdict).toBe("block");
    expect(r.counts.breaking).toBeGreaterThanOrEqual(1); // explicit 200 removal must be flagged
    expect(r.counts.additive).toBe(0);
  });

  it("204 newly added -> additive, verdict pass", () => {
    const before = openApiDoc({
      "/tasks": {
        delete: {
          summary: "Delete task",
          responses: { "200": { description: "Deleted" }, "404": { description: "Not found" } }
        }
      }
    });
    const after = clone(before);
    const del = ((after.paths as Json)["/tasks"] as Json).delete as Json;
    (del.responses as Json)["204"] = { description: "No content" };
    const r = cmp(before, after);
    expect(r.verdict).toBe("pass");
    expect(r.counts.breaking).toBe(0);
    expect(r.counts.ambiguous).toBe(0);
    expect(r.counts.additive).toBeGreaterThanOrEqual(1);
    expect(r.findings.every((f) => f.changeType === "additive")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 9: type and format changes
// ---------------------------------------------------------------------------

describe("contract edge: type and format changes", () => {
  function typedOp(prop: Json): Json {
    return {
      summary: "Create task",
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", properties: { value: prop } } } }
      },
      responses: { "201": { description: "Created" } }
    };
  }

  function docFor(prop: Json): Json {
    return openApiDoc({ "/tasks": { post: typedOp(prop) } });
  }

  it("type string -> integer -> exactly one breaking finding", () => {
    const r = cmp(docFor({ type: "string" }), docFor({ type: "integer" }));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].changeType).toBe("breaking");
    expect(r.findings[0].severity).toBe("high");
    expect(r.verdict).toBe("block");
    expect(r.before.hash).not.toBe(r.after.hash);
  });

  it("format int32 -> int64 -> ambiguous, verdict warn", () => {
    const r = cmp(docFor({ type: "integer", format: "int32" }), docFor({ type: "integer", format: "int64" }));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].changeType).toBe("ambiguous");
    expect(r.findings[0].severity).toBe("medium");
    expect(r.verdict).toBe("warn");
  });

  it("type and format both changed -> breaking, not ambiguous", () => {
    const r = cmp(docFor({ type: "string", format: "date" }), docFor({ type: "integer", format: "int64" }));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].changeType).toBe("breaking");
    expect(r.verdict).toBe("block");
  });
});

// ---------------------------------------------------------------------------
// Group 10: description/summary-only changes
// ---------------------------------------------------------------------------

describe("contract edge: description and summary-only changes", () => {
  it("docs/summaries change, wire contract unchanged -> zero findings", () => {
    const before = openApiDoc({
      "/tasks": {
        get: {
          summary: "List tasks",
          description: "Returns the task list.",
          parameters: [
            { name: "q", in: "query", required: false, description: "Filter text", schema: { type: "string" } }
          ],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      total: { type: "integer", description: "Total count of tasks" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });
    const after = clone(before);
    const get = ((after.paths as Json)["/tasks"] as Json).get as Json;
    get.summary = "List all tasks";
    get.description = "Returns every task in the workspace.";
    ((get.parameters as Json[])[0] as Json).description = "Optional search filter";
    const resp200 = (get.responses as Json)["200"] as Json;
    resp200.description = "Task collection";
    const schema = ((resp200.content as Json)["application/json"] as Json).schema as Json;
    ((schema.properties as Json).total as Json).description = "How many tasks exist";
    const r = cmp(before, after);
    expect(r.verdict).toBe("pass");
    expect(r.findings).toHaveLength(0);
    expect(r.counts).toEqual({ breaking: 0, ambiguous: 0, additive: 0 });
  });
});

// ---------------------------------------------------------------------------
// Group 11: determinism (same input twice; reordered keys/paths)
// ---------------------------------------------------------------------------

describe("contract edge: determinism", () => {
  function richPair(): { before: Json; after: Json } {
    const before = openApiDoc({
      "/tasks": {
        get: {
          summary: "List",
          parameters: [{ name: "q", in: "query", required: false, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { total: { type: "string" } } }
                }
              }
            }
          }
        },
        post: {
          summary: "Create",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", properties: { status: { type: "string", enum: ["open", "closed"] } } }
              }
            }
          },
          responses: { "201": { description: "Created" } }
        }
      },
      "/tasks/{id}": {
        get: { summary: "Get", responses: { "200": { description: "OK" } } },
        delete: { summary: "Delete", responses: { "204": { description: "Gone" } } }
      },
      "/users": {
        get: { summary: "Users", responses: { "200": { description: "OK" } } }
      }
    });
    const after = clone(before);
    const tasks = (after.paths as Json)["/tasks"] as Json;
    (tasks.get as Json).parameters = [{ name: "q", in: "query", required: true, schema: { type: "string" } }];
    const post = tasks.post as Json;
    const schema = (((post.requestBody as Json).content as Json)["application/json"] as Json).schema as Json;
    ((schema.properties as Json).status as Json).enum = ["open"];
    const byId = (after.paths as Json)["/tasks/{id}"] as Json;
    delete byId.delete; // removed operation -> breaking
    const users = (after.paths as Json)["/users"] as Json;
    (users as Json).post = { summary: "Create user", responses: { "201": { description: "Created" } } };
    return { before, after };
  }

  it("same input run twice -> identical result including finding ids and order", () => {
    const { before, after } = richPair();
    const r1 = cmp(before, after, ["b1", "h1"]);
    const r2 = cmp(before, after, ["b1", "h1"]);
    expect(r2).toEqual(r1);
    expect(JSON.stringify(r2.findings)).toBe(JSON.stringify(r1.findings));
    expect(r1.findings.length).toBeGreaterThanOrEqual(3); // the diff genuinely has multiple findings
  });

  it("reordered top-level keys, paths and methods -> identical findings array (deep equal)", () => {
    const { before, after } = richPair();
    const canonical = cmp(before, after, ["b", "h"]);

    // same logical after-doc, but: top-level keys reordered, paths reversed, methods reversed
    const a = after as { openapi: string; info: Json; paths: Json };
    const tasks = a.paths["/tasks"] as Json;
    const reorderedTasks: Json = {
      post: tasks.post,
      get: tasks.get
    };
    const byId = a.paths["/tasks/{id}"] as Json;
    const reordered: Json = {
      paths: {
        "/users": a.paths["/users"],
        "/tasks/{id}": { get: byId.get },
        "/tasks": reorderedTasks
      },
      info: a.info,
      openapi: a.openapi
    };
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(after)); // genuinely different byte order
    const shuffled = cmp(before, reordered, ["b", "h"]);
    expect(shuffled.verdict).toBe(canonical.verdict);
    expect(shuffled.counts).toEqual(canonical.counts);
    expect(shuffled.findings).toEqual(canonical.findings); // deep equal incl. ids and order
  });
});

// ---------------------------------------------------------------------------
// Group 12: fingerprint stability across different specs
// ---------------------------------------------------------------------------

describe("contract edge: fingerprint stability", () => {
  it("identical logical change in two different specs -> identical finding id", () => {
    const removedOp = { summary: "Fetch item", responses: { "200": { description: "OK" } } };

    // Spec A: unrelated extra path, title A
    const beforeA = openApiDoc(
      { "/items/{id}": { get: removedOp }, "/other": { get: { summary: "Other", responses: { "200": { description: "OK" } } } } },
      { title: "Spec A", version: "1.0.0" }
    );
    const afterA = clone(beforeA);
    delete (afterA.paths as Json)["/items/{id}"];

    // Spec B: different unrelated extra path and op, title B
    const beforeB = openApiDoc(
      { "/items/{id}": { get: removedOp }, "/extra": { post: { summary: "Extra", responses: { "201": { description: "Made" } } } } },
      { title: "Spec B", version: "2.0.0" }
    );
    const afterB = clone(beforeB);
    delete (afterB.paths as Json)["/items/{id}"];

    const rA = cmp(beforeA, afterA, ["base-a", "head-a"]);
    const rB = cmp(beforeB, afterB, ["base-b", "head-b"]);

    expect(rA.findings).toHaveLength(1);
    expect(rB.findings).toHaveLength(1);
    expect(rA.findings[0].changeType).toBe("breaking"); // removed operation blocks
    expect(rB.findings[0].changeType).toBe("breaking");
    expect(rA.verdict).toBe("block");
    expect(rB.verdict).toBe("block");
    // the fingerprint: same rule/path/method/detail -> same id regardless of surrounding spec
    expect(rB.findings[0].id).toBe(rA.findings[0].id);
  });
});

// ---------------------------------------------------------------------------
// Group 13: malformed inputs
// ---------------------------------------------------------------------------

describe("contract edge: malformed parse inputs", () => {
  const badSources: Array<[string, string]> = [
    ["empty string", ""],
    ["random prose", "this is not an openapi document at all, just prose"],
    ["bare JSON object", "{}"],
    ["YAML list", "- a\n- b\n- c\n"],
    ["bare number", "42"],
    ["broken YAML syntax", "openapi: 3.0.3\npaths: [unclosed\n"],
    ["wrong-typed spec", "openapi: 3.0.3\npaths: 17\n"]
  ];

  for (const [name, source] of badSources) {
    it(`parseOpenApi rejects ${name} with ok:false and a non-empty error`, () => {
      let r: ReturnType<typeof parseOpenApi> | undefined;
      expect(() => {
        r = parseOpenApi(source);
      }).not.toThrow();
      expect(r).toBeTruthy();
      expect(r!.ok).toBe(false);
      if (!r!.ok) {
        expect(typeof r!.error).toBe("string");
        expect(r!.error.length).toBeGreaterThan(0);
      }
    });
  }
});

describe("contract edge: compareContracts with unparseable side (fail-closed)", () => {
  const goodSource = JSON.stringify(
    openApiDoc({ "/tasks": { get: { summary: "List", responses: { "200": { description: "OK" } } } } })
  );

  // The module documents: compareContracts throws an Error when either side fails
  // parseOpenApi — no partial result. Assert that documented fail-closed contract.
  function probe(garbageSide: "before" | "after"): void {
    const input =
      garbageSide === "before"
        ? { before: { source: "{{{ not a document", label: "garbage-before" }, after: { source: goodSource, label: "good-after" } }
        : { before: { source: goodSource, label: "good-before" }, after: { source: "", label: "garbage-after" } };
    expect(() => compareContracts(input)).toThrow(Error);
    // the thrown error must carry a usable message (fail closed, not fail opaque)
    try {
      compareContracts(input);
    } catch (e) {
      expect((e as Error).message.length).toBeGreaterThan(0);
    }
  }

  it("unparseable before side: throws a documented, messaged Error instead of a partial verdict", () => {
    probe("before");
  });

  it("unparseable after side: throws a documented, messaged Error instead of a partial verdict", () => {
    probe("after");
  });
});
