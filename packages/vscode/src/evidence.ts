import { isAbsolute, relative, sep } from "node:path";

/** Selected files remain literal argv; inspection never executes imported checks. */
export function evidenceInspectionArgs(cwd: string, bundle: string, policy: string): string[] {
  for (const value of [cwd, bundle, policy]) {
    if (!isAbsolute(value) || value.includes("\0")) throw new Error("Select absolute evidence paths.");
  }
  const selected = [bundle, policy].map(value => {
    const path = relative(cwd, value);
    if (!path || isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) {
      throw new Error("Select evidence and policy inside the workspace.");
    }
    return path.split(sep).join("/");
  });
  return ["evidence", "inspect", "--cwd", cwd, "--bundle", selected[0]!, "--policy", selected[1]!, "--json"];
}

export function formatEvidenceInspection(stdout: string): string {
  if (Buffer.byteLength(stdout, "utf8") > 1024 * 1024) throw new Error("Evidence response exceeds the editor limit.");
  const report: unknown = JSON.parse(stdout);
  if (!report || typeof report !== "object" || Array.isArray(report)) throw new Error("Invalid evidence response.");
  const value = report as Record<string, unknown>;
  if (value.schemaVersion !== 1 || value.kind !== "evidence-inspection" ||
      !["verified", "contradicted", "missing", "inconclusive"].includes(String(value.state)) ||
      typeof value.sourceRevision !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.sourceRevision) ||
      !Array.isArray(value.records) || !Array.isArray(value.issues)) {
    throw new Error("The CLI did not return a supported evidence inspection report.");
  }
  return JSON.stringify(report, null, 2);
}
