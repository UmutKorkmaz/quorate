# ContractCourt fixtures

A hand-derived before/after corpus for `quorate contract check`. Every pair
holds two OpenAPI 3.0 snapshots of the same small "Tasks API"
(`/tasks` GET+POST, `/tasks/{id}` GET+PATCH; `Task` with `id`, `title`,
`status` enum, `dueDate`; 200/201/400/404 responses). Each pair isolates one
compatibility rule — or one deliberate mix — so the verdict can be checked by
hand. All `*.before.yaml` files are byte-identical copies of one baseline;
each `*.after.yaml` applies exactly the change named in its filename. The one
`.json` pair repeats an additive scenario to show JSON parsing.

## Run a pair

```sh
quorate contract check \
  --before examples/contract/tasks.removed-operation.before.yaml \
  --after  examples/contract/tasks.removed-operation.after.yaml
```

Add `--gate` for CI use: the run exits non-zero only when the verdict is
BLOCK (WARN and PASS exit 0). Verdict semantics: any breaking change →
**block**; otherwise any ambiguous change → **warn**; only additive changes →
**pass**. Run the whole corpus with:

```sh
for b in examples/contract/*.before.*; do
  quorate contract check --before "$b" --after "${b/.before./.after.}" --gate
done
```

## Verdict map

Verdict rule table: **breaking** = removed operation, newly required
parameter, newly required request field, incompatible type change, removed
enum value, removed 2xx response; **additive** = compatible additions;
**ambiguous** = anything honestly unclear.

| Pair (`tasks.<scenario>.{before,after}.yaml`) | Change vs baseline | Rule exercised | Expected |
| --- | --- | --- | --- |
| `removed-operation` | `PATCH /tasks/{id}` deleted | breaking: removed operation | **block** |
| `new-required-param` | GET /tasks gains required `workspace` query param | breaking: newly required parameter | **block** |
| `new-required-field` | `TaskCreate` gains `priority`, added to `required` | breaking: newly required request field | **block** |
| `type-change` | `Error.code` type string → integer | breaking: incompatible type change | **block** |
| `removed-enum-value` | `TaskStatus` enum loses `in_progress` | breaking: removed enum value | **block** |
| `removed-response` | POST /tasks drops legacy `200`; `201` stays | breaking: removed 2xx response | **block** |
| `added-operation` | `/tasks/{id}` gains `DELETE` (204/404) | additive: new operation | **pass** |
| `added-optional-param` | GET /tasks gains optional `sort` query param | additive: new optional parameter | **pass** |
| `added-optional-field` | `TaskCreate` gains optional `assignee` | additive: new optional request field | **pass** |
| `added-enum-value` | `TaskStatus` enum gains `blocked` | additive: enum value added | **pass** |
| `added-response` | PATCH /tasks/{id} gains `204` | additive: new 2xx response | **pass** |
| `ambiguous-format-change` | `Task.id` format int32 → int64; GET /tasks optional `limit` param removed | ambiguous: format-only type change; removed optional parameter | **warn** |
| `mixed-changes` | `status` query param now required + optional `assignee` added + `Task.id` int32 → int64 | mixed: breaking dominates | **block** (1 breaking, 5 ambiguous, 1 additive — the format change is reported once per operation that documents the affected schema) |
| `json-demo.{before,after}.json` | `TaskCreate` gains optional `assignee` (JSON format) | additive: new optional request field | **pass** |
