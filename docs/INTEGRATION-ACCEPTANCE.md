# Current acceptance status

As of 2026-10-11, 1.5.0 is publicly released on GitHub, npm, VS Code Marketplace and the website. The owned native Fix-terminal journey was completed after folder trust was confirmed on 2026-10-04. Historical pending statements below describe earlier snapshots.

The 1.6.0 evidence-suite candidate is undergoing independent review, packaged installation, native Terminal/editor acceptance and exact-revision CI. Candidate evidence is retained under the ignored .superpowers/sdd/evidence-suite directory. Installed-App and partner validation remain externally blocked as documented in [partner validation](PARTNER-VALIDATION.md).

# Integration reliability acceptance

Pre-integration acceptance was collected against baseline `d3e192e00e015837c0b2065f8b918aa349017e7e` plus the working diff on `fix/integration-reliability`. The QA records bind that tested candidate independently of its subsequent local commit or merge. No public candidate release is claimed. Tooling: macOS, Node 22.22.3, declared npm 11.7.0 temporary runtime, Vitest 4.1.11. Exact diff identity and packaged artifact evidence are in the local QA records.

Published baseline: npm 1.4.1; standalone verifier performed a fresh registry installation and passed on 2026-10-02. This does not validate the unpublished candidate.

| Journey | Required result | Observed evidence on 2026-10-02 |
| --- | --- | --- |
| Settings setup/remove | Invalid input untouched, exact backup, unrelated keys preserved | 24 focused tests with real temporary files, malformed/denied/swapped inputs |
| External sessions | Dead hook PID stays running; idle stale; end terminal; no signaling | Actual built hook CLI + Comet dashboard: two sessions running after hook exit; beta stale, alpha done and late events do not reopen; Abort denied |
| Verdict controls | CSP-safe mouse/keyboard toggle, navigation, rerun, fix | Candidate development host: mouse/Space/Enter toggle, `example.ts:2` navigation, real Re-run and correct bound Fix picker passed. Terminal portion pending Restricted Mode; trust unchanged. VSIX install succeeded in isolated profile but CUA could not address that separate instance |
| tmux Jump | Exact session/window/pane selected by normalized TTY | Actual browser Jump + owned tmux client: `other` -> `native`; `native:0.1` -> `native:0.0`, `/dev/ttys006`. Unrelated tmux server untouched |
| Review Abort | Exit 130/143, no owned survivors or success receipt | Comet Abort: exit 130, both reviewer PIDs dead, final spool error, no final success JSON. Four source tests include authenticated SIGINT and repeated SIGTERM (143), fresh receipt absence and unrelated sentinel preservation |
| Published CLI recovery | Exact fresh installation, clean 0 and unsafe 1 | Published npm 1.4.1 passed; recovery helper never republishes |
| Regression classification | Expected BASE failure, HEAD pass; never verify incomplete observations | 24 frozen cases (4 live Vitest, 20 captured output), plus real mutation/import/truncation/cancellation checks |
| Candidate tarball | Fresh install and fixed/unfixed/inconclusive exits, report verification and source preservation | Fresh owned npm installation with scripts disabled: 0/verified, 1/not-fixed, 2/setup-failed; local trust verification and exact source/worktree preservation passed |
| Candidate builds | JS/core/CLI/Action, types, App and website; VSIX | All local builds/type checks and VSIX packaging passed. Final post-review full suite: 143 files passed, 1,770 tests passed, one skipped (1771 total); all 14 standalone ContractCourt fixtures passed |
| Platform CI | Exact candidate Linux/macOS/Windows workflows | macOS local execution passed; Linux/Windows exact candidate CI pending authorized GitHub handoff. Windows execution is unsupported before setup; simulated preflight refusal passed without checkout/setup. POSIX process/ownership tests skip Windows; read-only inspection is designed cross-platform |
| Installed GitHub App | Signed webhook, dedupe/restart and revision freshness | Pending: webhook delivery inactive; no supplied HTTPS deployment, authorized test installation or privately configured credentials. Local App tests/build are separate evidence |

Generated evidence remains ignored under `.superpowers/sdd/2026-10-02-integration-reliability/` and `.superpowers/sdd/2026-10-02-regression-proof/`. The package acceptance JSON records full report artifact hashes, measured durations, tool versions and source preservation. The final review includes the entire working diff and new files. These acceptance records precede local Git integration. No version has been bumped or public candidate release published. Hosted publication and partner outreach remain separate decisions.

Final fresh review found three Important issues: inconsistent suite counters, case-colliding BASE overlays, and short install budgets. Each reproduction failed before its fix and passed afterward. No Critical or Minor findings were raised; the single fix pass finished with the green full suite above. A real installed Vitest nested-suite journey also passed. Counts that cannot be reconstructed from reporter ancestry remain inconclusive.

Final type checks, JS builds, GitHub App build/typecheck, website build, VSIX packaging, shell syntax and diff whitespace checks passed. Fresh candidate tarball journeys again returned 0/verified, 1/not-fixed and 2/setup-failed, each with valid explicit local trust and source/worktree preservation. The updated standalone verifier again installed published npm 1.4.1 successfully; that remains baseline evidence. No lint runner was available to the reviewer. The Git attachment fixture exceeded its original five-second test allowance under full-suite load twice; focused assertions passed, and the final suite passed after its test-only allowance became fifteen seconds. Product timeouts did not change.

The owned native monitor, isolated VS Code profile process and isolated tmux server were stopped after acceptance. The development-host test folder, screenshot and ignored QA records remain available for the pending folder-trust/Fix-terminal check. Workspace trust and user extension state remain unchanged. The main checkout was unchanged throughout implementation acceptance; local integration is recorded separately. Final identity/artifact hashes are in `.superpowers/sdd/2026-10-02-regression-proof/final-candidate-identity.json`.

## Evidence-suite candidate acceptance (2026-10-11)

P2–P8 have implemented command surfaces and independent source reviews. Corrective
regressions cover immutable GitHub asset identity, recovery deadlines, pinned
regression bytes, fresh release observations, manifest budgets, export root identity and create-only writes,
architecture resource budgets, consumer impact closure, inline rule imports,
and Windows path confinement. Native process execution in release/docs adapters
is explicitly unavailable on Windows; read-only report and evidence flows remain
in the CI matrix. Fixture observations and supplied installed-version metadata
do not establish native agent enforcement or model quality.

Final local verification passed 163 files and 1,984 tests, with one skipped.
Builds, type checks, all 14 ContractCourt fixtures and the dependency audit passed.
The final source review has no remaining Critical or Important findings.

The rebuilt 1.6.0 archive passed installation, version/help, setup demo and both
gate outcomes. The native VS Code inspector opened the selected evidence report;
the integrated Terminal ran all 20 fixture journeys. macOS Terminal.app access
was refused by the Computer tool, so that specific surface was not tested. The
website page rendered at four widths and mobile documentation navigation passed.
Clipboard copying was attempted but remained unverified in the browser backend.

The user selected the umutkorkmaz.net server. An isolated, unactivated App bundle
passed Linux Node syntax, systemd unit and proposed nginx configuration checks,
plus loopback health and synthetic signed/invalid pings. Actual App credentials,
GitHub installation and real PR acceptance remain pending fresh authentication.
Production website configuration is unchanged. No partners are available, so
partner results and P9 selection remain pending.

## Release integration verification (2026-10-03)

The historical acceptance above predates Git integration. The final feature
candidate `d3900a03d28d2f21e244728fedac8953f666c7ad` aligns all workspaces at 1.5.0 and passed
[Linux, macOS and Windows CI](https://github.com/UmutKorkmaz/quorate/actions/runs/37105253683).
The [hosted review](https://github.com/UmutKorkmaz/quorate/actions/runs/37105253695)
completed all provider lanes on retry but reported a high-severity Windows
compatibility regression that independent source review rejected: v1.4.1
already refused that execution in validateOptions. The first attempt also
incorrectly claimed renameSync was missing, though the import exists. No severity
gate or runtime containment was weakened to accommodate these findings.
Independent source reviews also verified the final fixes and deterministic Action.

Fresh local full-suite verification passed 144 files and 1,809 tests, with one
skip. The tarball installed into an owned temporary directory passed regression
run/show/verify, fixed (0), unfixed (1), and setup-failed/inconclusive (2) journeys,
explicit local trust, a required review attachment, relative key paths under
--cwd, and exact source/worktree preservation. Added boundary tests cover the full
100-test manifest and rejection beyond its argument bounds. Git provenance is
bound to the chosen repository despite inherited hook Git environment variables.

Windows short-path aliases use native canonicalization. Git queries retain normal
machine line-ending configuration while removing inherited Git environment
overrides. Generic ProofRunner execution already refused Windows
in 1.4.1, and regression execution retains that platform boundary. Read-only
regression inspection and verification are exercised in the platform matrix.

The native VS Code Fix-terminal launch remains pending explicit trust for the
owned fixture folder. Installed-App acceptance remains pending HTTPS hosting,
private credentials and a test installation; webhook delivery remains inactive
as previously selected. These gaps are separate from CLI package acceptance.
The release workflow performs the final clean-main matrix and GitHub-first OIDC
publication; verify its outcome and the exact registry version for distribution.
