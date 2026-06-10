import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PACK_COVERAGE } from "../src/pack-coverage.js";
import { runHeuristicReview } from "../src/heuristics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

const EXPECTED_PACK_IDS = [
  "solana",
  "evm",
  "iac",
  "llm",
  "move",
  "ci",
  "fintech",
  "web",
  "healthcare",
  "mobile"
] as const;

const PACK_VULNERABLE_FIXTURES: Record<string, string[]> = {
  solana: [
    "unchecked-account.diff",
    "raw-cpi.diff",
    "skip-preflight.diff",
    "panic.diff",
    "non-canonical-bump.diff",
    "manual-close.diff",
    "unvalidated-token.diff",
    "unchecked-arithmetic.diff",
    "hardcoded-keypair.diff",
    "constraint-removed.diff"
  ],
  evm: [
    "tx-origin.diff",
    "delegatecall.diff",
    "selfdestruct.diff",
    "assembly.diff",
    "block-timestamp.diff",
    "unbounded-loop.diff",
    "floating-pragma.diff",
    "ether-call.diff",
    "unchecked-call.diff",
    "unchecked-erc20.diff"
  ],
  iac: [
    "public-acl.diff",
    "open-ingress.diff",
    "encryption-disabled.diff",
    "public-ip.diff",
    "hardcoded-secret.diff",
    "privileged.diff",
    "host-namespace.diff",
    "run-as-root.diff",
    "privilege-escalation.diff",
    "latest-tag.diff"
  ],
  llm: [
    "prompt-interpolation.diff",
    "output-to-eval.diff",
    "output-to-html.diff",
    "tool-args.diff",
    "hardcoded-key.diff",
    "prompt-logged.diff",
    "moderation-off.diff",
    "pii-in-prompt.diff",
    "authz-from-model.diff",
    "external-into-prompt.diff"
  ],
  move: [
    "public-entry.diff",
    "borrow-global-mut.diff",
    "move-from.diff",
    "shared-object.diff",
    "copy-ability.diff",
    "downcast.diff",
    "privileged-fun.diff",
    "vector-borrow.diff",
    "drop-key.diff",
    "init-entrypoint.diff"
  ],
  ci: [
    "pull-request-target.diff",
    "expression-injection.diff",
    "unpinned-action.diff",
    "broad-permissions.diff",
    "self-hosted.diff",
    "pr-head-checkout.diff",
    "install-script.diff",
    "hardcoded-token.diff",
    "pipe-to-shell.diff",
    "docker-latest.diff"
  ],
  fintech: [
    "float-money.diff",
    "card-in-logs.diff",
    "card-literal.diff",
    "cvv-stored.diff",
    "webhook-unverified.diff",
    "float-math.diff",
    "pii-plaintext.diff",
    "tls-disabled.diff",
    "currency-rounding.diff",
    "sql-concat.diff"
  ],
  web: [
    "ssrf.diff",
    "command-injection.diff",
    "path-traversal.diff",
    "reflected-xss.diff",
    "open-redirect.diff",
    "mass-assignment.diff",
    "cors-wildcard.diff",
    "csrf-disabled.diff",
    "insecure-deserialization.diff",
    "weak-crypto.diff"
  ],
  healthcare: [
    "phi-in-logs.diff",
    "phi-plaintext.diff",
    "phi-in-url.diff",
    "phi-to-external.diff",
    "phi-in-response.diff",
    "phi-to-analytics.diff",
    "patient-idor.diff",
    "clinical-credential.diff",
    "broad-phi-query.diff",
    "weak-phi-encryption.diff"
  ],
  mobile: [
    "insecure-storage.diff",
    "hardcoded-secret.diff",
    "cleartext-traffic.diff",
    "exported-component.diff",
    "webview-js.diff",
    "tls-disabled.diff",
    "sensitive-logging.diff",
    "debuggable.diff",
    "insecure-random.diff",
    "keychain-accessibility.diff"
  ]
};

function readFixture(packId: string, name: string): string {
  return readFileSync(join(fixturesDir, packId, name), "utf8");
}

function getDetectedTitles(packId: string, vulnFixtures: string[]): Set<string> {
  const knownTitles = new Set(PACK_COVERAGE[packId].map((e) => e.title));
  const detected = new Set<string>();
  for (const file of vulnFixtures) {
    const diff = readFixture(packId, file);
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    for (const finding of result.findings) {
      if (knownTitles.has(finding.title)) {
        detected.add(finding.title);
      }
    }
  }
  return detected;
}

describe("PACK_COVERAGE — structural invariants", () => {
  it("has exactly 10 pack keys", () => {
    const keys = Object.keys(PACK_COVERAGE);
    expect(keys).toHaveLength(10);
    for (const id of EXPECTED_PACK_IDS) {
      expect(keys, `Missing pack: ${id}`).toContain(id);
    }
  });

  it("every entry has a non-empty title, standard, and reference", () => {
    for (const [packId, entries] of Object.entries(PACK_COVERAGE)) {
      for (const entry of entries) {
        expect(
          entry.title.length,
          `${packId}: title must be non-empty`
        ).toBeGreaterThan(0);
        expect(
          entry.standard.length,
          `${packId}: standard must be non-empty for "${entry.title}"`
        ).toBeGreaterThan(0);
        expect(
          entry.reference.length,
          `${packId}: reference must be non-empty for "${entry.title}"`
        ).toBeGreaterThan(0);
      }
    }
  });

  it("each pack has exactly 10 entries", () => {
    for (const [packId, entries] of Object.entries(PACK_COVERAGE)) {
      expect(entries, `${packId} should have 10 entries`).toHaveLength(10);
    }
  });
});

describe("PACK_COVERAGE — sync with vulnerable fixtures", () => {
  for (const packId of EXPECTED_PACK_IDS) {
    it(`${packId}: covered titles exactly match titles produced by vulnerable fixtures`, () => {
      const vulnFixtures = PACK_VULNERABLE_FIXTURES[packId];
      const coveredTitles = new Set(PACK_COVERAGE[packId].map((e) => e.title));
      const detectedTitles = getDetectedTitles(packId, vulnFixtures);

      // Every detected title must be in coverage (no stale mapping)
      for (const detected of detectedTitles) {
        expect(
          coveredTitles.has(detected),
          `${packId}: detected title "${detected}" is not in PACK_COVERAGE`
        ).toBe(true);
      }

      // Every covered title must be detected by at least one fixture (no unmapped class)
      for (const covered of coveredTitles) {
        expect(
          detectedTitles.has(covered),
          `${packId}: covered title "${covered}" was NOT detected by any vulnerable fixture`
        ).toBe(true);
      }

      // Sets must be equal in size
      expect(detectedTitles.size).toBe(coveredTitles.size);
    });
  }
});

describe("PACK_COVERAGE — benign fixtures produce zero false positives", () => {
  const benignDir = join(fixturesDir, "benign");
  const benignFiles = readdirSync(benignDir).filter((f) => f.endsWith(".diff"));
  const allKnownTitles = new Set(
    Object.values(PACK_COVERAGE).flatMap((entries) => entries.map((e) => e.title))
  );

  it(`all ${benignFiles.length} benign fixtures yield zero heuristic findings`, () => {
    for (const benignFile of benignFiles) {
      const diff = readFileSync(join(benignDir, benignFile), "utf8");
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      const matched = result.findings.filter((f) => allKnownTitles.has(f.title));
      expect(
        matched,
        `benign/${benignFile} produced unexpected findings: ${matched.map((f) => f.title).join(", ")}`
      ).toHaveLength(0);
    }
  });
});
