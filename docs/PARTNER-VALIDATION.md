# First-gate and partner validation

This protocol prepares the design-partner work in [LAUNCH.md](./LAUNCH.md).
It does not report recruited partners or measured model quality.

## First gate

Use Node 22.22 or later. Until v1.4.0 is published, install the candidate tarball;
after publication use the exact version below:

```bash
npm install --global quorate@1.4.0
quorate --version
quorate setup demo
```

The offline demo must show an unsafe change blocked, the correction, and a
passing gate. Keep its generated reports and record elapsed setup time. This
checks the deterministic lane and requires no model credentials.

In a disposable branch of the partner repository:

```bash
quorate doctor
quorate setup github-action
git diff -- .github/workflows/quorate.yml
```

Review the generated workflow and provider configuration before committing.
Run one known unsafe PR and its correction. Record both check URLs, head SHAs,
report artifacts, verdicts, exit codes, and any coverage limitation. A successful
workflow whose review is degraded or truncated is not complete review evidence.

For the VS Code surface, install the release VSIX, run Quorate Doctor, review the
same fixture, open a finding, and verify its file and line. Exercise Fix and
Revert only in the disposable branch; record the exact report/fingerprint used.
Activation alone does not validate that complete editor flow.

## Record each onboarding session

Use one row per opted-in repository and week. Keep private source and credentials
out of shared notes. Feedback stays local unless the repository owner agrees to
share it.

| Field | Evidence to record |
| --- | --- |
| Repository and consent | Repository identifier, owner, permitted reports |
| Environment | OS, Node and Quorate versions, integration surface |
| Setup | Start/end time, commands, first point of confusion |
| Gate reliability | Unsafe and corrected check URLs and verdicts |
| Finding outcome | Fingerprint, confirmed/false-positive/accepted-risk/fixed |
| Failure | Minimal reproducer, expected result, actual result |
| Repeat use | Second-week PRs and whether the gate remained enabled |

Bind feedback to a saved report before labeling:

```bash
quorate feedback targets --report review.json
quorate feedback add --report review.json --finding 1 --outcome confirmed --reason "Reproduced in the fixture"
```

The example outcome is not a default: use the human-verified outcome for each
finding. Feedback does not silently alter policy or suppress the gate.

## Held-out comparison

1. Freeze the change corpus and expected issue IDs before examining model output.
   Include clean changes, breaking changes, and realistic ambiguous cases. Keep
   tuning cases separate from the final evaluation set.
2. Save deterministic, single-provider, and council reports for the same base and
   head revisions and comparable policies. Record provider/model configuration,
   timestamps, timeouts, retry policy, and available cost evidence.
3. Have a human map every finding fingerprint to an expected issue ID, or `null`
   for a false positive. Resolve disputed labels and retain the rationale.
4. Create a manifest with the same variants for every case. Paths are relative
   to the manifest. This template needs real saved reports and fingerprints:

```json
{
  "schema": 1,
  "cases": [{
    "id": "held-out-change-1",
    "expectedIssueIds": ["issue-1"],
    "runs": [
      {"variant": "deterministic", "report": "reports/deterministic.json", "labels": {}},
      {"variant": "single", "report": "reports/single.json", "labels": {}},
      {"variant": "council", "report": "reports/council.json", "labels": {}}
    ]
  }]
}
```

```bash
quorate evaluate manifest.json --json > evaluation.json
```

Empty labels are incomplete when findings exist. Unknown precision, recall,
duration, or cost must remain unknown. Report corpus size, labeling completeness,
provider errors, degraded runs, duplicate findings, and per-case results alongside
aggregate metrics. The evaluator reads supplied reports; it neither calls models
nor independently validates the ground truth. Do not claim model improvement
from the bundled deterministic fixtures or synthetic test reports.

## Hosted App acceptance

A container health check and signed ping do not prove an installed App workflow.
With an authorized test installation, verify a real PR delivery, signature
rejection, duplicate delivery, restart/recovery, updated PR head, final check and
comment, and persisted decision receipt. Record installation/repository IDs and
delivery/check IDs without copying private keys or webhook secrets.

## Product decision

After 3–5 repositories have repeated use, compare setup friction, gate failures,
actionable findings and observed demand. Update [ROADMAP.md](./ROADMAP.md) using
those results. Recruitment, live credentials, human labels and partner outcomes
remain external inputs; this protocol alone does not satisfy the adoption gate.
