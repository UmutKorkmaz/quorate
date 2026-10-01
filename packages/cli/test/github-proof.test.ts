import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readGitHubProof } from "../src/github-proof.js";
vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
const dirs: string[] = [];
afterEach(() => { vi.resetAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const policy = { repo: "owner/repo", workflow: ".github/workflows/proof.yml", ref: "refs/heads/main", sourceDigest: "a".repeat(40) };
function file() { const dir=mkdtempSync(join(tmpdir(),"q-gh-proof-")); dirs.push(dir); const path=join(dir,"proof.json"); writeFileSync(path,'{"result":"original"}'); return path; }
it("pins all certificate identities and verifies an immutable snapshot", () => {
  const path = file(); let snapshot = "";
  vi.mocked(spawnSync).mockImplementation((command: any, args: any) => {
    expect(command).toBe("gh"); snapshot = args[2];
    expect(readFileSync(snapshot,"utf8")).toBe('{"result":"original"}');
    writeFileSync(path,'{"result":"changed"}');
    expect(args).toEqual(["attestation","verify",snapshot,"--repo",policy.repo,"--signer-workflow",`${policy.repo}/${policy.workflow}`,"--source-ref",policy.ref,"--source-digest",policy.sourceDigest,"--signer-digest",policy.sourceDigest,"--deny-self-hosted-runners","--cert-oidc-issuer","https://token.actions.githubusercontent.com","--predicate-type","https://slsa.dev/provenance/v1","--format","json"]);
    return { status: 0, stdout: '[{"verificationResult":{}}]' } as any;
  });
  expect(readGitHubProof(path,policy)).toEqual({ result: "original" });
  expect(existsSync(snapshot)).toBe(false);
});
it.each([{status:1,stdout:""},{status:0,stdout:"[]"},{status:0,stdout:"not-json"},{status:null,error:new Error("timeout"),stdout:""}])("rejects unavailable, failed or empty verification: %o", result => {
  vi.mocked(spawnSync).mockReturnValue(result as any);
  expect(()=>readGitHubProof(file(),policy)).toThrow();
});
it("rejects missing identity or non-commit source before running gh",()=>{
  expect(()=>readGitHubProof(file(),{...policy,sourceDigest:"main"})).toThrow();
  expect(()=>readGitHubProof(file(),{...policy,workflow:"../../other.yml"})).toThrow();
  expect(spawnSync).not.toHaveBeenCalled();
});
