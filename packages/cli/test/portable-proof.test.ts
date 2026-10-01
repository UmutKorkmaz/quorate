import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { generateProofKeyPair, exportPortableProof, readPortableProof } from "../src/portable-proof.js";
import { runProof, verifyPortableProof, verifyLatestProof, proofAttachmentFor, attachLatestProofToReview } from "../src/proof-runner.js";

const dirs: string[] = [];
const oldKeyDir = process.env.QUORATE_PROOF_KEY_DIR;
afterEach(() => {
  if (oldKeyDir === undefined) delete process.env.QUORATE_PROOF_KEY_DIR; else process.env.QUORATE_PROOF_KEY_DIR = oldKeyDir;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "q-portable-")); dirs.push(dir);
  const repo = join(dir, "producer");
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "fixture"]);
  process.env.QUORATE_PROOF_KEY_DIR = join(dir, "producer-keys");
  const privateKey = join(dir, "signer.key"), publicKey = join(dir, "signer.pub"), envelope = join(dir, "proof.json");
  generateProofKeyPair(privateKey, publicKey);
  return { dir, repo, privateKey, publicKey, envelope };
}
describe("portable trusted-signer proofs", () => {
  it.skipIf(process.platform === "win32")("verifies in a second checkout without sharing the local HMAC key and attaches to review", async () => {
    const f = fixture();
    const result = await runProof({ cwd: f.repo, name: "test", command: [process.execPath, "-e", "console.log('passed')"] });
    exportPortableProof(result.artifact, f.privateKey, f.envelope);
    const consumer = join(f.dir, "consumer");
    execFileSync("git", ["clone", "-q", f.repo, consumer]);
    cpSync(join(f.repo, ".quorate"), join(consumer, ".quorate"), { recursive: true });
    process.env.QUORATE_PROOF_KEY_DIR = join(f.dir, "consumer-keys");
    expect(verifyLatestProof(consumer).ok).toBe(false);
    expect(verifyPortableProof(consumer, f.envelope, f.publicKey).ok).toBe(true);
    expect(proofAttachmentFor(consumer, f.envelope, f.publicKey)?.artifact?.exitCode).toBe(0);
    expect(proofAttachmentFor(consumer, f.envelope)?.artifact).toBeUndefined();
    const attached = attachLatestProofToReview({ mode: "review", subject: "fixture", repoPath: consumer }, f.envelope, f.publicKey);
    expect(attached.request.proof?.content).toContain("explicitly trusted signer");
    writeFileSync(join(consumer, "changed.txt"), "changed");
    expect(verifyPortableProof(consumer, f.envelope, f.publicKey).reason).toBe("stale");
  });
  it("rejects wrong signers, changed evidence, malformed signatures, and overwrites", () => {
    const f = fixture();
    exportPortableProof({ test: "passed" }, f.privateKey, f.envelope);
    const other = join(f.dir, "other.pub"); generateProofKeyPair(join(f.dir, "other.key"), other);
    expect(() => readPortableProof(f.envelope, other)).toThrow();
    expect(() => exportPortableProof({}, f.privateKey, f.envelope)).toThrow();
    const original = JSON.parse(readFileSync(f.envelope, "utf8"));
    writeFileSync(f.envelope, JSON.stringify({ ...original, payload: '{"test":"failed"}' }));
    expect(() => readPortableProof(f.envelope, f.publicKey)).toThrow();
    writeFileSync(f.envelope, JSON.stringify({ ...original, signature: "invalid" }));
    expect(() => readPortableProof(f.envelope, f.publicKey)).toThrow();
  });
  it("does not trust a valid signer to bypass proof schema and content hashes", () => {
    const f = fixture();
    exportPortableProof({ schemaVersion: 1, exitCode: 0 }, f.privateKey, f.envelope);
    expect(verifyPortableProof(f.repo, f.envelope, f.publicKey).ok).toBe(false);
  });
});
