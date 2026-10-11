# Architecture and impact

`quorate arch check --input subject.json --subject <full-sha> --baseline base.json --base <full-sha> --policy architecture-policy.json --json` imports explicitly prepared dependency-cruiser modules. `quorate impact` uses the same options plus `--changed src/api.ts,src/shared.ts`. Neither command invokes dependency-cruiser or tests. Existing CI remains enabled.

Imports wrap dependency-cruiser JSON modules with revision and coverage metadata:

```json
{"version":1,"revision":"1111111111111111111111111111111111111111","scope":["src"],"complete":true,"modules":[{"source":"src/api.ts","dependencies":[]}]}
```

Optional policy:

```json
{"version":1,"boundaries":[{"id":"ui-no-db","from":"src/ui","to":"src/db"}],"layers":["src/db","src/domain","src/ui"],"contracts":[{"path":"src/api.ts","consumers":["src/ui"],"checks":["consumer-api"]}],"fullSuite":["all-tests"]}
```

Layers are ordered from lower to higher; importing a higher layer from a lower one violates the policy. Prefix matching respects directory boundaries. Checks are recommendation identifiers, never commands to execute. Contract mappings activate for every affected contract, including indirect graph dependents and contracts reached through configured consumers, until no further paths are affected. Mapping order does not change the report. Report schema 1 separates historical and new violations, cycles, inbound/outbound degree hotspots, changed/affected paths, recommended checks and coverage diagnostics. Unknown dynamic, external, unresolved, unknown/undetermined dependency types, un-followed or generated relationships and missing modules prevent complete claims and recommend configured full-suite checks. Degree hotspots prioritize review and do not predict incidents.

Exact subject/base revisions must match independently. No baseline means every observed violation is new. The baseline and subject must have matching declared scopes. Scope is producer-declared, not independently verified source coverage; import integrity does not attest producer identity. Exit 0 means valid complete imported analysis with no new violation, 1 means observed new violation, 2 means invalid or incomplete input. Deterministic reports contain no wall clock field.

Input files must be regular files inside the selected working directory, maximum 8 MiB. Imports reject unsafe paths, duplicate module identifiers, invalid metadata and malformed structures. Symbol-level runtime behavior, external service consumers, generated relationships and unsupported languages remain unknown.

Analysis shares deterministic limits across the subject, baseline and impact traversal: 1,000,000 work operations, 2,000 diagnostic/violation records and 4 MiB of retained report data. Consumer prefixes are cached, and each affected path is scheduled only once. A policy that exceeds a limit returns exit 2, `complete: false`, a `resource-budget-exceeded` diagnostic and configured full-suite recommendations. Partial violation, cycle, hotspot and changed/affected lists are discarded after exhaustion; empty lists in that report do not imply no violations or no impact. These limits also apply to policy comparisons and graph traversal, including cases with no matching rule.

Dependency-cruiser module shape is grounded in its [official result types](https://github.com/sverweij/dependency-cruiser/blob/main/types/cruise-result.d.mts). Explicit revision/coverage metadata is a Quorate envelope rather than an upstream field.
