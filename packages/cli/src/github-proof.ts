import { readBoundedProofFile } from "./portable-proof.js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface GitHubProofPolicy {
  repo: string;
  workflow: string;
  ref: string;
  sourceDigest: string;
}

/** Verify a snapshot, not a mutable path, against the operator's explicit identity policy. */
export function readGitHubProof(path: string, policy: GitHubProofPolicy): unknown {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(policy.repo) ||
      !/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(policy.workflow) ||
      !policy.ref.startsWith("refs/heads/") || !/^[a-f0-9]{40}$/.test(policy.sourceDigest)) {
    throw new Error("Expected an explicit GitHub repository, workflow file, branch ref, and source commit.");
  }
  const raw = readBoundedProofFile(path);
  const dir = mkdtempSync(join(tmpdir(), "quorate-attestation-"));
  try {
    const snapshot = join(dir, "proof.json");
    writeFileSync(snapshot, raw, { mode: 0o600, flag: "wx" });
    const result = spawnSync("gh", ["attestation", "verify", snapshot,
      "--repo", policy.repo,
      "--signer-workflow", `${policy.repo}/${policy.workflow}`,
      "--source-ref", policy.ref,
      "--source-digest", policy.sourceDigest,
      "--signer-digest", policy.sourceDigest,
      "--deny-self-hosted-runners",
      "--cert-oidc-issuer", "https://token.actions.githubusercontent.com",
      "--predicate-type", "https://slsa.dev/provenance/v1",
      "--format", "json"], { encoding: "utf8", shell: false, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error("GitHub attestation verification failed; require a current authenticated gh CLI and matching hosted-workflow provenance.");
    const verified = JSON.parse(result.stdout);
    if (!Array.isArray(verified) || verified.length === 0) throw new Error("GitHub returned no verified attestation.");
    return JSON.parse(raw.toString("utf8"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
