# Acceptance evidence

Write explicit IDs, for example:

```markdown
- [AC-LOGIN] rejects an invalid password
- [AC-COPY] error wording is clear [human]
```

Map criteria to check IDs in a user-maintained file. `specDigest` is SHA256 of exact UTF-8 spec bytes; `sourceRevision` optionally pins an implementation SHA; omit it in reusable tracked mappings, which bind the exact runtime revision from the operator policy. Reports always record the exact implementation SHA. An `ai-advisory` mapping stays advisory until a human accepts it.

```json
{"schemaVersion":1,"specDigest":"<64 lowercase hex>","sourceRevision":"<implementation SHA>","origin":"human","criteria":[{"id":"AC-LOGIN","checks":["login-test"]}]}
```

Run `quorate acceptance check --spec requirements.md --mapping acceptance.json --evidence evidence-bundle --policy evidence-policy.json --json`. Passing every command can still leave a criterion missing. Subjective criteria require human review; contradictory accepted evidence wins over a passing observation. An inconclusive observation cannot be hidden by another pass. Reported states are `demonstrated`, `contradicted`, `missing`, and `human-review`, with exact spec digest, implementation revision and evidence references.

For PR gates add `--base <exact trusted base SHA>`. The CLI reads the same repository-relative spec, mapping and policy paths from that immutable Git commit, resolves current HEAD independently, and binds the candidate mapping to HEAD. Only the expected source revision is rebound; signer keys, accepted digests and required checks stay from the trusted base policy. Candidate policy changes cannot relax the gate. Deleted base criteria and removed checks stay visible. Changed exact spec bytes require review of base criteria, including changes in continuation text. Required base checks remain enforced even if no candidate criterion maps them.

Bounded imports use `--format openspec` for `### Requirement: [AC-ID] text`, and `--format speckit` for `- **FR-001**: text`. The Markdown default recognizes bullet/heading IDs. Fenced examples are excluded. Unidentified prose, duplicate IDs and unsupported layouts fail visibly; this is not an unrestricted importer for every tool/version layout. Specs are bounded to 1 MiB and 256 criteria.

Exit codes: 0 all criteria demonstrated and evidence policy satisfied; 1 contradicted; 2 missing, invalid or requiring human review. Adoption remains explicit; the command does not enable a blocking repository policy by itself.
