import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runHeuristicReview } from "../src/heuristics.js";
import type { Finding } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures", "benign");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return "(none)";
  return findings.map((f) => `  • [${f.severity}] "${f.title}" @ ${f.file ?? "?"}:${f.line ?? "?"}`).join("\n");
}

const BENIGN_FIXTURES: Array<{ name: string; file: string }> = [
  { name: "React component (escaped props, no dangerouslySetInnerHTML)", file: "react-component.tsx.diff" },
  { name: "Express route (validated input, parameterized query, allow-listed redirect, scoped CORS, CSRF on)", file: "express-route.ts.diff" },
  { name: "Flask handler (yaml.safe_load, sha256, parameterized SQL)", file: "flask-handler.py.diff" },
  { name: "Service with output/result/response variables in non-exec contexts", file: "service.ts.diff" },
  { name: "Safe Anchor program (typed accounts, checked_add, no unwrap)", file: "safe-anchor.rs.diff" },
  { name: "Safe Solidity contract (pinned pragma, msg.sender, nonReentrant, SafeERC20)", file: "safe-contract.sol.diff" },
  { name: "Safe Move module (entry asserts signer, AdminCap-gated)", file: "safe-module.move.diff" },
  { name: "Terraform config (encrypted=true, scoped CIDR, no public ACL)", file: "main.tf.diff" },
  { name: "Kubernetes deployment (runAsNonRoot, pinned image, no privileged)", file: "deployment.yaml.diff" },
  { name: "GitHub Actions workflow (pull_request, SHA-pinned actions, least-priv perms)", file: "workflow.yml.diff" },
  { name: "package.json (normal dependency addition, NO install scripts)", file: "package.json.diff" },
  { name: "Payments service (integer cents, Stripe constructEvent, TLS verified)", file: "payments.ts.diff" },
];

describe("Benign corpus — every fixture must produce zero findings", () => {
  for (const { name, file } of BENIGN_FIXTURES) {
    it(`${file}: ${name} → 0 findings`, () => {
      const diff = readFixture(file);
      const result = runHeuristicReview({ mode: "review", subject: "benign-test", diff });
      expect(
        result.findings,
        `${file} produced unexpected findings:\n${formatFindings(result.findings)}`
      ).toHaveLength(0);
    });
  }
});

describe("Benign corpus — combined union is empty", () => {
  it("no findings across all 12 benign fixtures combined", () => {
    const allFindings: Finding[] = [];
    for (const { file } of BENIGN_FIXTURES) {
      const diff = readFixture(file);
      const result = runHeuristicReview({ mode: "review", subject: "benign-test", diff });
      allFindings.push(...result.findings);
    }
    expect(
      allFindings,
      `Combined benign corpus produced ${allFindings.length} unexpected findings:\n${formatFindings(allFindings)}`
    ).toHaveLength(0);
  });
});
