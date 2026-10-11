# Portable evidence inspector

`quorate evidence export --manifest selected.json --output evidence-bundle --json` copies explicitly selected JSON artifacts into a new directory. Selection paths and output are relative to `--cwd`. Existing output is refused. No imported commands execute.

```json
{"schemaVersion":1,"inputs":[{"id":"unit-proof","path":".quorate/proofs/latest.json"}]}
```

`quorate evidence inspect --bundle evidence-bundle --policy evidence-policy.json --json` reconstructs check results from artifact adapters, checks content addresses, and evaluates the explicit operator policy.

```json
{"schemaVersion":1,"sourceRevision":"0123456789012345678901234567890123456789","requiredChecks":["unit"],"acceptedDigests":[],"requireAuthenticatedProducer":true,"trustedProofKeys":[{"id":"maintainer","publicKeyPem":"-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"}]}
```

The operator pins full artifact byte digests in `acceptedDigests` to accept exact statements with content integrity only. Their producer remains `unattested`. An Ed25519 portable proof authenticates a statement only when its signer matches an explicitly supplied public key. This does not attest independent or hosted execution. Embedded `verified` and producer trust fields never establish trust. Local proof HMAC bytes are retained; export does not distribute the local key or convert it to portable authentication.

Adapters read legacy proof v1, ContractCourt artifacts, decision receipts, regression reports, approval audit JSON exports, release verification and docs-check reports. Release check IDs are `<destination>:<check>`. Audit exports lack revision/signature/head evidence and remain inconclusive. Contract artifacts without an exact SHA label cannot establish revision freshness. Docs freshness is reported independently and stale/unknown documentation cannot satisfy a passing check. Unknown schemas remain visible; required unknown evidence is inconclusive. Explicit `check-observation` v1 statements have `sourceRevision`, `subjectDigest`, `producer.id`, and `checks[{id,outcome,requirements}]`; accepting their bytes is an operator decision, not an execution verifier.

The inspector reports separate integrity, producer trust, check outcome, source revision, and coverage fields. Distinct issue codes include `wrong-revision`, `missing-check`, `contradicted-check`, `untrusted-producer`, `invalid-integrity`, `unsupported-schema`, and `unavailable-evidence`, with next-check guidance. Optional unsupported evidence remains visible while selected required checks govern the decision.

Bundles permit at most 256 records, 4 MiB per JSON artifact, 16 MiB total selected artifact bytes, a 4 MiB serialized manifest, and bounded acyclic references. Export enforces the inspection manifest limit before creating its output directory. Absolute/traversal/backslash paths, symlink components, duplicate IDs/checks/references, missing references, oversized reads and replaced files are rejected. Artifacts live at `artifacts/<sha256>.json`; original selected bytes are preserved. Inspection is read-only and has no hosted-history dependency.

Exit codes: 0 verified against the supplied policy; 1 contradicted; 2 missing/invalid/inconclusive. A verified inspection is limited to those required checks and that revision.
