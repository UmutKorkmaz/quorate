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
  "mobile",
  "accessibility",
  "data-sql",
  "k8s",
  "privacy",
  "mlops",
  "embedded",
  "performance",
  "graphql"
] as const;

const PACK_VULNERABLE_FIXTURES: Record<string, string[]> = {
  solana: [
    "unchecked-account.diff",
    "raw-cpi.diff",
    "remaining-accounts.diff",
    "cpi-program-unpinned.diff",
    "skip-preflight.diff",
    "unconfirmed-transaction.diff",
    "blockhash-expiry.diff",
    "signature-only-confirmation.diff",
    "deprecated-blockhash.diff",
    "panic.diff",
    "non-canonical-bump.diff",
    "manual-close.diff",
    "unvalidated-token.diff",
    "token-2022-extension.diff",
    "unchecked-arithmetic.diff",
    "authority-invariant.diff",
    "hardcoded-keypair.diff",
    "constraint-removed.diff",
    "constraint-weakened.diff",
    "invariant-removed.diff"
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
  ],
  "accessibility": [
    "image-missing-alt-attribute.diff",
    "form-input-relies-on-placeholder-instead-of-a-labe.diff",
    "click-handler-on-non-interactive-element-without-r.diff",
    "anchor-with-empty-or-placeholder-href-used-as-a-bu.diff",
    "root-html-element-missing-lang-attribute.diff",
    "positive-tabindex-value-disrupts-focus-order.diff",
    "icon-only-button-without-an-accessible-name.diff",
    "misspelled-or-invalid-aria-attribute.diff",
    "autoplaying-media-that-is-not-muted.diff",
    "heading-level-skipped-h1-directly-to-h3.diff"
  ],
  "data-sql": [
    "sql-query-built-by-string-concatenation-or-f-strin.diff",
    "select-used-in-a-production-query.diff",
    "update-or-delete-statement-missing-a-where-clause.diff",
    "unbounded-query-missing-a-limit-clause.diff",
    "drop-or-truncate-table-without-an-existence-or-env.diff",
    "hardcoded-database-connection-string-or-dsn.diff",
    "pii-column-selected-into-logs-or-printed-output.diff",
    "cartesian-or-cross-join-that-explodes-row-counts.diff",
    "multiple-dependent-writes-executed-without-a-trans.diff",
    "float-or-real-used-for-a-monetary-column.diff"
  ],
  "k8s": [
    "privileged-container-in-securitycontext.diff",
    "container-allowed-to-run-as-root.diff",
    "container-runs-as-uid-0-root.diff",
    "privilege-escalation-allowed.diff",
    "host-namespace-sharing-enabled.diff",
    "dangerous-linux-capability-added.diff",
    "container-missing-resource-limits.diff",
    "mutable-latest-image-tag.diff",
    "service-account-token-automounted.diff",
    "rbac-rule-grants-wildcard-access.diff"
  ],
  "privacy": [
    "pii-written-to-logs.diff",
    "analytics-fired-before-consent.diff",
    "pii-stored-without-retention-ttl.diff",
    "pii-in-url-query-string.diff",
    "pii-shared-with-third-party-without-contract-flag.diff",
    "soft-delete-used-instead-of-right-to-erasure.diff",
    "cookie-set-without-consent-gating.diff",
    "precise-geolocation-captured-without-notice.diff",
    "full-pii-table-dumped.diff",
    "pii-sent-to-analytics-ml-without-anonymisation.diff"
  ],
  "mlops": [
    "untrusted-model-artifact-deserialized-via-pickle-t.diff",
    "torch-load-called-without-weights-only-true.diff",
    "no-random-seed-set-training-is-non-reproducible.diff",
    "data-leakage-scaler-transform-fit-before-train-tes.diff",
    "hardcoded-dataset-registry-storage-credentials.diff",
    "unsafe-yaml-load-for-experiment-pipeline-config.diff",
    "unpinned-model-dataset-download-from-hub.diff",
    "model-trained-on-full-dataset-with-no-train-test-s.diff",
    "eval-exec-on-experiment-config-or-hyperparameters.diff",
    "target-identifier-leakage-column-kept-in-training-.diff"
  ],
  "embedded": [
    "unbounded-string-operation-strcpy-strcat-sprintf-g.diff",
    "allocation-result-used-without-null-check.diff",
    "memcpy-memmove-with-an-unchecked-length.diff",
    "magic-buffer-size-literal-in-array-declaration.diff",
    "hardware-register-isr-shared-variable-missing-vola.diff",
    "signed-unsigned-comparison-mismatch-in-loop-bound.diff",
    "use-of-goto.diff",
    "dynamic-allocation-via-new-on-a-real-time-isr-path.diff",
    "ignored-return-value-of-a-system-library-call.diff",
    "floating-point-equality-comparison.diff"
  ],
  "performance": [
    "await-inside-a-loop-serialized-i-o.diff",
    "database-query-inside-a-loop-n-1.diff",
    "list-endpoint-missing-pagination-limit.diff",
    "synchronous-fs-call-in-a-request-path.diff",
    "outbound-fetch-axios-without-a-timeout.diff",
    "new-db-connection-per-request-no-pool.diff",
    "unbounded-in-memory-accumulator-growth.diff",
    "json-parse-of-an-unbounded-request-body.diff",
    "o-n-2-nested-includes-indexof-scan.diff",
    "setinterval-without-cleanup-handle-leak.diff"
  ],
  "graphql": [
    "graphql-introspection-enabled-in-production.diff",
    "missing-query-depth-complexity-limit.diff",
    "list-resolver-causes-n-1-queries-no-dataloader.diff",
    "privileged-resolver-missing-object-field-level-aut.diff",
    "query-batching-amplification-enabled.diff",
    "raw-database-query-built-from-graphql-args.diff",
    "verbose-graphql-error-leaks-internals.diff",
    "mutation-type-without-rate-limit-directive.diff",
    "unbounded-list-pagination-argument.diff",
    "skip-include-used-to-bypass-auth-protected-field.diff"
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
  it("has exactly 18 pack keys", () => {
    const keys = Object.keys(PACK_COVERAGE);
    expect(keys).toHaveLength(18);
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

  it("each pack has the expected number of entries", () => {
    for (const [packId, entries] of Object.entries(PACK_COVERAGE)) {
      const expected = packId === "solana" ? 21 : 10;
      expect(entries, `${packId} should have ${expected} entries`).toHaveLength(expected);
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
