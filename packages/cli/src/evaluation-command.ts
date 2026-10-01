import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const VARIANTS = ["deterministic", "single", "council"] as const;
type Variant = (typeof VARIANTS)[number];
type ObjectValue = Record<string, unknown>;

export interface EvaluationRun {
  caseId: string;
  variant: Variant;
  reportHash: string;
  reviewId: string | null;
  findings: number;
  truePositives: number;
  falsePositives: number;
  duplicates: number;
  unlabeled: number;
  expected: number | null;
  falseNegatives: number | null;
  precision: number | null;
  recall: number | null;
  durationMs: number | null;
  estimatedInputCostUsd: number | null;
  degraded: boolean;
  providerErrors: number;
}

export interface EvaluationReport {
  schema: 1;
  kind: "saved-report-evaluation";
  manifestHash: string;
  cases: number;
  runs: EvaluationRun[];
  variants: Array<{
    variant: Variant;
    runs: number;
    labeledRuns: number;
    precision: number | null;
    recall: number | null;
    truePositives: number;
    falsePositives: number;
    duplicates: number;
    falseNegatives: number | null;
    medianDurationMs: number | null;
    estimatedInputCostUsd: number | null;
    degradedRuns: number;
    providerErrors: number;
  }>;
  limitations: string[];
}

function object(value: unknown, label: string): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as ObjectValue;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1000) throw new Error(`${label} must be a non-empty string of at most 1000 characters.`);
  return value;
}

function readJson(path: string): { value: unknown; hash: string } {
  const info = statSync(path);
  if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error(`${path} must be a regular JSON file smaller than 8 MiB.`);
  const content = readFileSync(path, "utf8");
  try { return { value: JSON.parse(content) as unknown, hash: createHash("sha256").update(content).digest("hex") }; }
  catch { throw new Error(`Invalid JSON in ${path}.`); }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function evaluateRun(caseId: string, expected: Set<string> | undefined, input: unknown, directory: string): EvaluationRun {
  const run = object(input, `Run in ${caseId}`);
  if (!VARIANTS.includes(run.variant as Variant)) throw new Error(`Run in ${caseId} needs variant deterministic, single, or council.`);
  const variant = run.variant as Variant;
  const stored = readJson(resolve(directory, identifier(run.report, "Report path")));
  const report = object(stored.value, "Saved report");
  const metadata = object(report.metadata, "Report metadata");
  if (!Array.isArray(report.findings) || !Array.isArray(report.providerResults) || !["pass", "warn", "fail"].includes(String(report.verdict)) || typeof metadata.degraded !== "boolean") {
    throw new Error(`Invalid saved CouncilReport for ${caseId}/${variant}.`);
  }
  const providers = report.providerResults.map((row) => object(row, "Provider result"));
  for (const provider of providers) {
    identifier(provider.providerId, "Provider ID");
    if (!["mock", "cli", "api"].includes(String(provider.providerType)) || !["ok", "error", "skipped", "interrupted"].includes(String(provider.status))) throw new Error("Saved report has invalid provider evidence.");
  }
  const realProviders = new Set(providers.filter((row) => row.providerType !== "mock").map((row) => row.providerId));
  if ((variant === "deterministic" && realProviders.size !== 0) || (variant === "single" && realProviders.size !== 1) || (variant === "council" && realProviders.size < 2)) {
    throw new Error(`Variant ${variant} does not match the provider evidence for ${caseId}.`);
  }
  const fingerprints = report.findings.map((row) => identifier(object(row, "Finding").fingerprint, "Finding fingerprint"));
  const fingerprintSet = new Set(fingerprints);
  if (fingerprintSet.size !== fingerprints.length) throw new Error(`Duplicate finding fingerprints in ${caseId}/${variant}; labels would be ambiguous.`);
  const labels = run.labels === undefined ? {} : object(run.labels, "Finding labels");
  for (const [fingerprint, issueId] of Object.entries(labels)) {
    if (!fingerprintSet.has(fingerprint)) throw new Error(`Label ${fingerprint} is not a finding in ${caseId}/${variant}.`);
    if (issueId !== null) {
      identifier(issueId, "Labeled issue ID");
      if (expected && !expected.has(issueId as string)) throw new Error(`Label references an unknown expected issue in ${caseId}/${variant}.`);
    }
  }
  const matched = new Set<string>();
  let falsePositives = 0, duplicates = 0, unlabeled = 0;
  for (const fingerprint of fingerprints) {
    if (!Object.hasOwn(labels, fingerprint)) { unlabeled++; continue; }
    const issueId = labels[fingerprint];
    if (issueId === null) falsePositives++;
    else if (matched.has(issueId as string)) duplicates++;
    else matched.add(issueId as string);
  }
  const complete = expected !== undefined && unlabeled === 0;
  const budget = metadata.budget === undefined ? undefined : object(metadata.budget, "Report budget");
  const estimates = budget?.providerEstimates;
  const fullyPriced = Array.isArray(estimates) && estimates.length > 0 && estimates.every((row) => finiteNumber(object(row, "Provider estimate").inputCostUsd) !== null);
  return {
    caseId, variant, reportHash: stored.hash,
    reviewId: typeof metadata.reviewId === "string" ? metadata.reviewId : null,
    findings: fingerprints.length, truePositives: matched.size, falsePositives, duplicates, unlabeled,
    expected: expected?.size ?? null,
    falseNegatives: complete ? expected.size - matched.size : null,
    precision: complete ? ratio(matched.size, fingerprints.length) : null,
    recall: complete ? ratio(matched.size, expected.size) : null,
    durationMs: finiteNumber(metadata.durationMs),
    estimatedInputCostUsd: fullyPriced ? finiteNumber(budget?.estimatedInputCostUsd) : null,
    degraded: metadata.degraded,
    providerErrors: providers.filter((row) => row.status !== "ok").length
  };
}

/** Evaluate saved, manually labeled evidence only. This never executes a model or a command. */
export function evaluateManifest(path: string): EvaluationReport {
  const stored = readJson(resolve(path));
  const manifest = object(stored.value, "Evaluation manifest");
  if (manifest.schema !== 1 || !Array.isArray(manifest.cases) || manifest.cases.length === 0 || manifest.cases.length > 500) throw new Error("Evaluation schema 1 requires 1–500 cases.");
  const runs: EvaluationRun[] = [];
  const ids = new Set<string>();
  let variantSet: string | undefined;
  for (const input of manifest.cases) {
    const entry = object(input, "Evaluation case");
    const id = identifier(entry.id, "Case ID");
    if (ids.has(id)) throw new Error(`Duplicate evaluation case ${id}.`);
    ids.add(id);
    let expected: Set<string> | undefined;
    if (entry.expectedIssueIds !== undefined) {
      if (!Array.isArray(entry.expectedIssueIds) || entry.expectedIssueIds.length > 10000) throw new Error("expectedIssueIds must be an array of at most 10000 issue IDs.");
      const issues = entry.expectedIssueIds.map((value) => identifier(value, "Expected issue ID"));
      expected = new Set(issues);
      if (expected.size !== issues.length) throw new Error(`Duplicate expected issue ID in ${id}.`);
    }
    if (!Array.isArray(entry.runs) || entry.runs.length < 1 || entry.runs.length > 3) throw new Error(`Case ${id} needs 1–3 variant runs.`);
    const caseRuns = entry.runs.map((run) => evaluateRun(id, expected, run, dirname(resolve(path))));
    const variants = caseRuns.map((run) => run.variant).sort();
    if (new Set(variants).size !== variants.length) throw new Error(`Duplicate variant in ${id}.`);
    const key = variants.join(",");
    if (variantSet !== undefined && variantSet !== key) throw new Error("Every case must include the same variants for a paired comparison.");
    variantSet = key;
    runs.push(...caseRuns);
  }
  const variants = VARIANTS.filter((variant) => runs.some((run) => run.variant === variant)).map((variant) => {
    const selected = runs.filter((run) => run.variant === variant);
    const sum = (key: "truePositives" | "falsePositives" | "duplicates" | "findings" | "providerErrors"): number => selected.reduce((total, row) => total + row[key], 0);
    const labeledRuns = selected.filter((run) => run.expected !== null && run.unlabeled === 0).length;
    const complete = labeledRuns === selected.length;
    const durations = selected.map((run) => run.durationMs).filter((value): value is number => value !== null).sort((a, b) => a - b);
    const middle = Math.floor(durations.length / 2);
    const allTimed = durations.length === selected.length;
    return {
      variant, runs: selected.length, labeledRuns,
      truePositives: sum("truePositives"), falsePositives: sum("falsePositives"), duplicates: sum("duplicates"),
      falseNegatives: complete ? selected.reduce((total, row) => total + (row.falseNegatives ?? 0), 0) : null,
      precision: complete ? ratio(sum("truePositives"), sum("findings")) : null,
      recall: complete ? ratio(sum("truePositives"), selected.reduce((total, row) => total + (row.expected ?? 0), 0)) : null,
      medianDurationMs: allTimed ? durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2 : null,
      estimatedInputCostUsd: selected.every((row) => row.estimatedInputCostUsd !== null) ? selected.reduce((total, row) => total + (row.estimatedInputCostUsd ?? 0), 0) : null,
      degradedRuns: selected.filter((run) => run.degraded).length,
      providerErrors: sum("providerErrors")
    };
  });
  return {
    schema: 1, kind: "saved-report-evaluation", manifestHash: stored.hash, cases: ids.size, runs, variants,
    limitations: [
      "Uses supplied reports and human labels; this is not a live provider benchmark or independent verification of the labels.",
      "Precision and recall require complete labels plus expected issue IDs. Duplicate findings for one issue count as noise in precision.",
      "Null means unavailable or a zero denominator. Cost is estimated input cost only, and is unknown when any provider is unpriced.",
      "Cases are paired by manifest ID; the manifest author must ensure each variant reviewed the same change and comparable policy."
    ]
  };
}

export function renderEvaluation(report: EvaluationReport): string {
  const percent = (value: number | null): string => value === null ? "unknown" : `${(value * 100).toFixed(1)}%`;
  return [
    `Saved-report evaluation: ${report.cases} paired case(s)`,
    ...report.variants.map((row) => `${row.variant}: precision ${percent(row.precision)}, recall ${percent(row.recall)}, ${row.labeledRuns}/${row.runs} fully labeled runs; median ${row.medianDurationMs === null ? "unknown" : `${row.medianDurationMs} ms`}; estimated input cost ${row.estimatedInputCostUsd === null ? "unknown" : `$${row.estimatedInputCostUsd.toFixed(4)}`}; ${row.degradedRuns} degraded, ${row.providerErrors} provider error(s)`),
    "", ...report.limitations
  ].join("\n");
}
