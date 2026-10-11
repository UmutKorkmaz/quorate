# Finding adjudication

`quorate adjudication check --report council-report.json --attachments finding-evidence.json --evidence evidence-bundle --policy evidence-policy.json --json` inspects selected attachments without executing reproducers or modifying the saved council report or human labels.

```json
{"schemaVersion":1,"sourceRevision":"<implementation SHA>","attachments":[{"reviewId":"<saved review ID>","reportGeneratedAt":"<saved report timestamp>","reportHash":"<SHA256 of JSON.stringify(saved report)>","fingerprint":"<existing 16-character finding fingerprint>","evidenceId":"reproducer","checkId":"regression-test"}]}
```

The report hash uses the same exact JSON encoding as existing feedback. Each fingerprint is recomputed with the frozen core identity primitive; missing/ambiguous/altered report or finding identity rejects the attachment. Checks must explicitly cover `finding:<fingerprint>` in their requirements, be valid and accepted under the operator policy, and match the implementation revision. An unrelated passing test cannot strengthen a finding.

Output states are `supported`, `contradicted`, and `unverified`. These describe the attached evidence, not automatically assigned human ground truth. Majority voting alone remains unverified. Original provider attribution, minority findings, disagreements and the entire source report remain available. There is no automatic similarity consolidation that could hide differences.

Use existing `quorate feedback targets`/`quorate feedback record` and paired `quorate eval` workflows for human labels and evaluation. Adjudication does not rewrite labels, suppress findings, invent precision/recall, or claim complete provider/cost coverage. Reproducers run through separately selected trusted proof adapters; imports here never execute commands.

Exit codes: 0 every finding supported and policy satisfied; 1 contradicted; 2 missing/invalid/inconclusive. Reports and manifests are bounded, and duplicate attachments fail closed.
