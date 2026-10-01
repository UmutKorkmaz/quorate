import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixtures = join(root, "examples/contract");
const cli = process.argv[2] ?? join(root, "packages/cli/dist/index.js");
// Hand-derived expectations: shared enums occur in both input and output,
// while the YAML baseline contains unsupported minimum/maximum/readOnly facets.
const expected = {
  "added-enum-value": "block",
  "added-operation": "warn",
  "added-optional-field": "warn",
  "added-optional-param": "warn",
  "added-response": "warn",
  "ambiguous-format-change": "warn",
  "json-demo": "pass",
  "mixed-changes": "block",
  "new-required-field": "block",
  "new-required-param": "block",
  "removed-enum-value": "block",
  "removed-operation": "block",
  "removed-response": "block",
  "type-change": "block"
};
const workspace = mkdtempSync(join(tmpdir(), "quorate-contract-corpus-"));
try {
  const files = readdirSync(fixtures).filter(name => name.includes(".before.")).sort();
  assert.equal(files.length, Object.keys(expected).length, "Update expectations for added or removed fixtures");
  for (const file of files) {
    const scenario = file.split(".")[1];
    assert.ok(Object.hasOwn(expected, scenario), `Missing expectation: ${scenario}`);
    const result = spawnSync(process.execPath, [cli, "--cwd", workspace, "contract", "check",
      "--before", join(fixtures, file), "--after", join(fixtures, file.replace(".before.", ".after.")),
      "--json", "--gate"], { encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.signal, null, `${scenario}: terminated by signal`);
    const report = JSON.parse(result.stdout);
    assert.equal(report.verdict, expected[scenario], `${scenario}: unexpected verdict`);
    assert.equal(result.status, expected[scenario] === "block" ? 1 : 0, `${scenario}: wrong gate exit code: ${result.stderr}`);
    console.log(`${scenario}: ${report.verdict} (exit ${result.status})`);
  }
  console.log(`${files.length} contract fixtures passed.`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
