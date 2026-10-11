import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// These are synthetic, unattested observations. Digest acceptance tests an
// operator's explicit policy; it does not authenticate or attest a check run.
// Only the explicit docs journey executes commands (--version and --help).
const root = fileURLToPath(new URL("../", import.meta.url));
const cli = resolve(process.argv[2] ?? join(root, "packages/cli/dist/index.js"));
const platform = process.platform;
const workspace = mkdtempSync(join(tmpdir(), "quorate-evidence-corpus-"));
const revision = "a".repeat(40), baseline = "b".repeat(40);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const read = path => readFileSync(join(workspace, path), "utf8");
const json = path => JSON.parse(read(path));
const write = (path, value) => {
  mkdirSync(dirname(join(workspace, path)), { recursive: true });
  writeFileSync(join(workspace, path), typeof value === "string" ? value : JSON.stringify(value));
};
const home = join(workspace, "home");
mkdirSync(home);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT_|QUORATE_|INIT_CWD$|NODE_OPTIONS$)/i.test(key)));
Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, GIT_CONFIG_COUNT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(home, "gitconfig"), GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" });
const checks = [];
function invoke(label, args, expectedExit, parse = true, expectedStderr) {
  const result = spawnSync(process.execPath, [cli, "--cwd", workspace, ...args], {
    cwd: workspace, env, encoding: "utf8", shell: false, timeout: 30_000, maxBuffer: 1024 * 1024
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${label}: terminated by signal`);
  assert.equal(result.status, expectedExit, `${label}: unexpected exit; stderr=${result.stderr}; stdout=${result.stdout}`);
  if (expectedStderr) assert.match(result.stderr, expectedStderr, `${label}: missing refusal diagnostic`);
  const report = parse ? JSON.parse(result.stdout) : result.stdout;
  checks.push(label);
  console.log(`${label}: exit ${result.status}`);
  return report;
}
function snapshot() {
  const files = {};
  const walk = path => {
    for (const entry of readdirSync(join(workspace, path), { withFileTypes: true })) {
      const child = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child);
      else { assert.ok(entry.isFile(), "Unexpected non-file fixture"); files[child] = hash(readFileSync(join(workspace, child))); }
    }
  };
  walk("");
  return files;
}
function readOnly(label, args, expectedExit, parse = true, expectedStderr) {
  const before = snapshot();
  const report = invoke(label, args, expectedExit, parse, expectedStderr);
  assert.deepEqual(snapshot(), before, `${label}: changed fixture bytes or created files`);
  return report;
}
function exportObservation(name, outcome, requirements) {
  write(`${name}.json`, { schemaVersion: 1, kind: "check-observation", sourceRevision: revision,
    subjectDigest: hash("synthetic CLI acceptance subject"), producer: { id: "synthetic-unattested-fixture" },
    checks: [{ id: "fixture-check", outcome, requirements }],
    // An imported command is inert data, even if a compatible schema retains it.
    command: [process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(join(workspace, "import-executed"))}, 'unexpected execution')`] });
  write(`${name}-selected.json`, { schemaVersion: 1, inputs: [{ id: "fixture-evidence", path: `${name}.json` }] });
  const bundle = invoke(`${name} export`, ["evidence", "export", "--manifest", `${name}-selected.json`, "--output", `${name}-bundle`, "--json"], 0);
  assert.equal(bundle.records[0].producer.trust, "unattested");
  assert.equal(existsSync(join(workspace, "import-executed")), false, "Imported command executed during export");
  assert.equal(bundle.records[0].artifact.sha256, hash(read(`${name}.json`)));
  write(`${name}-policy.json`, { schemaVersion: 1, sourceRevision: revision, requiredChecks: ["fixture-check"], acceptedDigests: [bundle.records[0].artifact.sha256] });
  return bundle;
}

try {
  const version = invoke("selected CLI version", ["--version"], 0, false).trim();
  assert.match(version, /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/);
  // Fixed finding identity from the public SHA256 identity contract, independently
  // derived for this fixture; no product implementation is imported by this script.
  const fingerprint = hash(JSON.stringify(["high", "src/a.ts", "unsafe input"])).slice(0, 16);
  const bundle = exportObservation("passed", "passed", ["AC-1", `finding:${fingerprint}`]);
  const inspectArgs = ["evidence", "inspect", "--bundle", "passed-bundle", "--policy", "passed-policy.json", "--json"];
  const accepted = readOnly("operator digest accepted", inspectArgs, 0);
  assert.equal(accepted.state, "verified");
  assert.equal(accepted.records[0].accepted, true);
  assert.equal(accepted.records[0].producer.trust, "unattested");
  write("untrusted-policy.json", { ...json("passed-policy.json"), acceptedDigests: [] });
  const untrusted = readOnly("unaccepted producer", inspectArgs.map(arg => arg === "passed-policy.json" ? "untrusted-policy.json" : arg), 2);
  assert.equal(untrusted.records[0].accepted, false);
  assert.ok(untrusted.issues.some(issue => issue.code === "untrusted-producer"));
  const artifact = `passed-bundle/${bundle.records[0].artifact.path}`;
  const original = read(artifact);
  write(artifact, `${original} `);
  const tampered = readOnly("tampered artifact", inspectArgs, 2);
  assert.ok(tampered.issues.some(issue => issue.code === "invalid-integrity"));
  write(artifact, original);

  const spec = "- [AC-1] Explicit synthetic acceptance criterion\n";
  write("spec.md", spec);
  const mapping = { schemaVersion: 1, specDigest: hash(spec), sourceRevision: revision, origin: "human", criteria: [{ id: "AC-1", checks: ["fixture-check"] }] };
  write("mapping.json", mapping);
  const acceptanceArgs = (name, mappingPath = "mapping.json") => ["acceptance", "check", "--spec", "spec.md", "--mapping", mappingPath, "--evidence", `${name}-bundle`, "--policy", `${name}-policy.json`, "--json"];
  const demonstrated = readOnly("acceptance demonstrated", acceptanceArgs("passed"), 0);
  assert.equal(demonstrated.criteria[0].state, "demonstrated");
  exportObservation("failed", "failed", ["AC-1"]);
  const contradicted = readOnly("acceptance contradicted", acceptanceArgs("failed"), 1);
  assert.equal(contradicted.criteria[0].state, "contradicted");
  write("missing-mapping.json", { ...mapping, criteria: [{ id: "AC-1", checks: ["not-observed"] }] });
  const missing = readOnly("acceptance missing", acceptanceArgs("passed", "missing-mapping.json"), 2);
  assert.equal(missing.criteria[0].state, "missing");

  const graph = (rev, dependencies = []) => ({ version: 1, revision: rev, scope: ["src"], complete: true,
    modules: [{ source: "src/ui/a.ts", dependencies }, { source: "src/db/a.ts", dependencies: [] }] });
  write("graph.json", graph(revision));
  write("base-graph.json", graph(baseline));
  write("arch-policy.json", { version: 1, boundaries: [{ id: "ui-db", from: "src/ui", to: "src/db" }], layers: [], contracts: [], fullSuite: ["all-tests"] });
  const archArgs = ["arch", "check", "--input", "graph.json", "--subject", revision, "--baseline", "base-graph.json", "--base", baseline, "--policy", "arch-policy.json", "--json"];
  assert.equal(readOnly("architecture complete", archArgs, 0).complete, true);
  write("graph.json", graph(revision, [{ resolved: "src/db/a.ts", dynamic: true }]));
  const unknown = readOnly("architecture unknown relationship", archArgs, 2);
  assert.equal(unknown.complete, false);
  assert.ok(unknown.unknown.length > 0);
  write("graph.json", graph(revision, [{ resolved: "src/db/a.ts" }]));
  assert.ok(readOnly("architecture new violation", archArgs, 1).newViolations.some(v => v.kind === "boundary"));

  write("rules.json", { version: 1, tools: { "claude-code": "2.1.0" }, files: [{ path: "CLAUDE.md", tool: "claude-code", kind: "instructions", scope: "project" }] });
  const rulesArgs = ["rules", "doctor", "--manifest", "rules.json", "--json"];
  assert.equal(readOnly("rules incomplete", rulesArgs, 2).complete, false);
  write("CLAUDE.md", "Run the explicitly selected checks.\n");
  const rules = readOnly("rules complete advisory audit", rulesArgs, 0);
  assert.equal(rules.complete, true);
  assert.ok(rules.rules.every(rule => rule.nativeObservation === "unverified"));

  const report = { verdict: "warn", summary: "Synthetic minority finding", findings: [{ severity: "high", title: "unsafe input", body: "Synthetic observation", file: "src/a.ts", providerId: "minority", agreedBy: ["minority"], agreement: 1, fingerprint }], providerResults: [],
    metadata: { reviewId: "synthetic-review", generatedAt: "2026-10-11T00:00:00.000Z", providers: ["minority", "majority"], requestedProviders: ["minority", "majority"], ranProviders: ["minority", "majority"], degraded: false, mode: "review", subject: "synthetic diff" } };
  write("report.json", report);
  const attachment = { reviewId: report.metadata.reviewId, reportGeneratedAt: report.metadata.generatedAt, reportHash: hash(JSON.stringify(report)), fingerprint, evidenceId: "fixture-evidence", checkId: "fixture-check" };
  write("attachments.json", { schemaVersion: 1, sourceRevision: revision, attachments: [attachment] });
  const adjudicationArgs = ["adjudication", "check", "--report", "report.json", "--attachments", "attachments.json", "--evidence", "passed-bundle", "--policy", "passed-policy.json", "--json"];
  const supported = readOnly("minority finding supported by accepted statement", adjudicationArgs, 0);
  assert.equal(supported.findings[0].state, "supported");
  assert.deepEqual(supported.findings[0].finding.agreedBy, ["minority"]);
  assert.deepEqual(supported.report, report);
  write("attachments.json", { schemaVersion: 1, sourceRevision: revision, attachments: [{ ...attachment, reportHash: "c".repeat(64) }] });
  assert.equal(readOnly("adjudication exact report mismatch", adjudicationArgs, 2, false), "");

  const windows = platform === "win32";
  const docsWitness = join(workspace, "docs-example-executed");
  if (windows) {
    // If a declared example runs despite Windows process-tree refusal, leave an
    // observable marker in our workspace before forwarding version/help argv.
    write("docs-witness.mjs", `import { writeFileSync } from 'node:fs';\nimport { spawnSync } from 'node:child_process';\nwriteFileSync(${JSON.stringify(docsWitness)}, 'unexpected example execution');\nconst result = spawnSync(process.execPath, [${JSON.stringify(cli)}, ...process.argv.slice(2)], { stdio: 'inherit', timeout: 5000 });\nprocess.exitCode = result.status ?? 2;\n`);
  }
  write("docs.json", { schemaVersion: 1, sourceRevision: revision, artifact: { mode: "source-candidate", entrypoint: windows ? join(workspace, "docs-witness.mjs") : cli }, deadlineMs: 20_000, maxOutputBytes: 65_536,
    steps: [{ id: "version", argv: ["{cli}", "--version"], expectedExit: 0, stdoutIncludes: [version], timeoutMs: 5000 }, { id: "help", argv: ["{cli}", "--help"], expectedExit: 0, stdoutIncludes: ["evidence", "acceptance", "adjudication"], timeoutMs: 5000 }] });
  const docsArgs = ["docs", "check", "--manifest", "docs.json", "--json"];
  if (windows) {
    assert.equal(readOnly("Windows native docs execution refused", docsArgs, 2, false, /unsupported|incomplete|could not safely complete/i), "");
    assert.equal(existsSync(docsWitness), false, "Windows refusal executed a declared example");
    assert.equal(existsSync(join(workspace, ".quorate/docs/latest.json")), false, "Windows refusal published a docs report");
    console.log("Windows native docs journey: unsupported; no declared example executed.");
  } else {
    const docs = invoke("explicit source docs version and help journey", docsArgs, 0);
    assert.equal(docs.artifactMode, "source-candidate");
    assert.equal(docs.functionalState, "verified");
    assert.equal(docs.freshness.state, "unknown");
    assert.deepEqual(docs.checks.map(check => [check.id, check.actualExit, check.outcome]), [["version", 0, "passed"], ["help", 0, "passed"]]);
    assert.equal(docs.producer.trust, "unattested");
    assert.deepEqual(json(".quorate/docs/latest.json"), docs);
  }

  // Rejected submission is an offline synthetic input. The real CLI persists a
  // failed report before any provider observation; status then reads that report.
  write("release.json", { schemaVersion: 1, sourceRevision: revision, deadlineMs: 1000, destinations: [{ id: "synthetic-rejected", kind: "npm", package: "synthetic-unattested-fixture", version: "0.0.0", expectedIntegrity: `sha512-${Buffer.alloc(64).toString("base64")}`, submission: "rejected" }] });
  const release = invoke("offline rejected submission persisted", ["release", "verify", "--manifest", "release.json", "--json"], 1);
  assert.equal(release.decision.state, "failed");
  assert.equal(release.destinations[0].observations.at(-1).code, "submission-rejected");
  assert.deepEqual(json(".quorate/releases/latest.json"), release);
  assert.deepEqual(json(`.quorate/releases/${release.manifestDigest}.json`), release);
  const statusArgs = ["release", "status", "--report", ".quorate/releases/latest.json", "--json"];
  assert.deepEqual(readOnly("persisted release status read only", statusArgs, 1), release);
  write("invalid-release.json", { ...release, decision: { state: "verified", reason: "Contradicts actual rejected submission" } });
  assert.equal(readOnly("contradictory release status rejected read only", statusArgs.map(arg => arg === ".quorate/releases/latest.json" ? "invalid-release.json" : arg), 2, false), "");
  assert.equal(existsSync(join(workspace, "import-executed")), false, "Imported command executed during inspection");
  console.log(`${checks.length} CLI acceptance checks passed. Synthetic evidence remained unattested; ${windows ? "19 evidence/offline flows checked; Windows native docs execution is unsupported and its refusal was checked" : "source docs journey ran locally"}. No hosted installation or native App enforcement is claimed.`);
} finally {
  // This unique directory is the only cleanup target owned by this script.
  rmSync(workspace, { recursive: true, force: true });
}
