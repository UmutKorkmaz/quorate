# Quorate GitHub Action

Run a [Quorate](https://github.com/UmutKorkmaz/quorate) review council on every pull
request: multiple AI reviewers over the PR diff, deduplicated into **one verdict**
(PASS / WARN / FAIL) with a summary comment, optional inline comments, and a check
that can fail on severity.

```yaml
name: Quorate
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: UmutKorkmaz/quorate@v1.1.0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

`v1.1.0` is the unreleased-candidate placeholder. The release checklist replaces
it with the reviewed bundle commit's full 40-character SHA before tagging;
production workflows should use that immutable ref.

## Which reviewers run in CI?

The council is defined by `.quorate.yml`, read from the pull request's **base branch**
(never the PR head — a PR can't supply the config that governs its own review). With
no config, only the built-in **heuristic** runs and the result is reported as
**degraded** (an honest WARN, never a confident green).

| Provider `type` | Runs on a GitHub-hosted runner? | How |
| --- | --- | --- |
| `mock` (heuristic) | ✅ always | Zero setup. |
| **`api`** (hosted/local model) | ✅ **yes** | Point at a hosted OpenAI-compatible gateway and put the key in `secrets`. No CLI install needed — the recommended way to get real AI review in CI. |
| `cli` (`claude`, `codex`, …) | ⚠️ no | Needs a **self-hosted runner** where those CLIs are installed and authenticated. |

The default `runner-mode: auto` is **runner-aware**: on GitHub-hosted runners it
keeps only `api` providers (+ the heuristic), so a council that also lists local
CLI agents never produces doomed "command not found" lanes in CI. Set
`runner-mode: cli` explicitly if your workflow preinstalls and authenticates
agent CLIs.

### Real AI review on GitHub-hosted runners (recommended)

Commit a `.quorate.yml` to your **base branch** with a `type: api` provider pointing
at a hosted gateway (OpenRouter, Hugging Face router, Groq, …):

```yaml
providers:
  - id: heuristic
    type: mock
    enabled: true
  - id: openrouter
    type: api
    enabled: true
    baseUrl: https://openrouter.ai/api/v1
    model: anthropic/claude-sonnet-4.6
    apiKeyEnv: OPENROUTER_API_KEY
    roles: [security, architect]
```

Then pass the key through as an environment variable:

```yaml
      - uses: UmutKorkmaz/quorate@v1.1.0
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          runner-mode: api   # only run HTTP-endpoint providers (+ heuristic)
```

Generate provider entries with `quorate provider add <id> --preset openrouter …`
(run `quorate provider presets` for the full list). Which model covers
which role is the `roles:` field per provider; tune it with `/route` locally before
committing.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | — | Token to read PR files and write comments. |
| `config-path` | `.quorate.yml` | Canonical base-branch config path; alternate PR-controlled paths are rejected. |
| `providers` | — | Comma-separated provider ids to enable for this run. |
| `pack` | — | Domain pack(s) to layer on: a list (e.g. `solana,web3-dd`) or `auto` to detect from the PR's changed files. |
| `fail-on` | `high` | May tighten the committed base policy; `never` or a weaker threshold cannot relax it. |
| `post-comment` | `true` | Post/update the Quorate summary comment. |
| `inline-comments` | `false` | Post findings as inline review comments on changed lines. |
| `inline-comment-limit` | `10` | Max inline comments per run. |
| `runner-mode` | `auto` | Restrict providers by type: `auto` (runner-aware), `cli` (local agents only), `api` (HTTP endpoints only). The heuristic always runs. |
| `baseline` | `false` | Deprecated compatibility input; the canonical valid, unexpired base baseline is automatic. |
| `baseline-path` | `.quorate.baseline.json` | Canonical trusted baseline path; alternate paths are rejected. |
| `suppress-path` | `.quorate/suppressions.json` | Canonical trusted suppression path; alternate paths are rejected. |
| `policy-path` | `.quorate/policy.yml` | Canonical trusted policy path; alternate paths are rejected. |
| `include-pr-context` | `false` | Include redacted PR title/body/commit context as untrusted read-only prompt input. |
| `reviewgraph` | `false` | Include ReviewGraph agreement evidence in the comment and summary. |
| `reviewgraph-file` | — | Write ReviewGraph JSON and expose `reviewgraph-path`. |
| `sarif-file` | — | Path to write a SARIF 2.1.0 report; exposed as the `sarif-path` output for upload-sarif. |
| `mode` | `review` | Only `review` is implemented for the Action. |

## Outputs

- `verdict` — the final verdict, lowercase `pass` / `warn` / `fail`.
- `findings` — the number of findings in the report.
- `sarif-path` — absolute path of the written SARIF file when `sarif-file` is set.
- `reviewgraph-path` — absolute path of ReviewGraph JSON when `reviewgraph-file` is set.

```yaml
      - id: quorate
        uses: UmutKorkmaz/quorate@v1.1.0
        with: { github-token: ${{ secrets.GITHUB_TOKEN }} }
      - if: steps.quorate.outputs.verdict == 'fail'
        run: echo "Quorate found ${{ steps.quorate.outputs.findings }} findings"
```

## Security

- Config is loaded from the **base branch**, so a pull request cannot enable a
  provider (or an arbitrary command) that governs its own review.
- API keys are read from the named `apiKeyEnv` at runtime — never stored in
  `.quorate.yml`. Keep them in repository/organization **secrets**.

See the full docs at
[umutkorkmaz.github.io/quorate/docs/github-action](https://umutkorkmaz.github.io/quorate/docs/github-action).

## Solana / Anchor

Quorate ships a Solana/Anchor pack with 21 deterministic on-chain and client
transaction heuristics: unchecked accounts, raw CPI, `remaining_accounts`, CPI
program pinning, disabled preflight, confirmation and blockhash-expiry mistakes,
Token-2022 validation gaps, authority/invariant regressions, hardcoded keypairs,
and removed or weakened Anchor constraints. Dedicated council roles cover program
security, account safety, transaction correctness, token safety, and maintainability.

Use it as a release gate for AI-assisted Solana changes:

- **Anchor constraint diff:** block high-risk removals of `has_one`, `signer`,
  `owner`, `seeds`, `bump`, `close`, or custom constraints unless tests prove the
  new account model.
- **Transaction safety:** keep preflight/simulation visible, review signer and fee
  payer changes, and require explicit confirmation/error handling.
- **CPI and remaining accounts:** prefer typed Anchor CPI contexts; if
  `invoke`, `invoke_signed`, or `remaining_accounts` is used, verify program id,
  account order, owner, signer/writable flags, duplicate accounts, and PDA seeds.
- **Token and Token-2022:** check mint, owner, token program id, decimals,
  delegate/freeze/close authorities, and extension behavior such as transfer hooks.
- **Test plan and invariants:** ask the council to turn serious findings into
  negative tests for wrong authority/mint/PDA/bump and invariants for vault
  ownership, close/reinitialization safety, and token/lamport conservation.

Bootstrap a Solana-ready config:

```bash
quorate init --pack solana
quorate solana doctor --strict
quorate solana test-plan
```

Then activate the ready-to-copy example workflow:

```bash
# copy and rename to activate
cp examples/github-workflows/quorate-solana.yml .github/workflows/quorate.yml
```

The example workflow lives at `examples/github-workflows/quorate-solana.yml` in the
[Quorate repository](https://github.com/UmutKorkmaz/quorate). Set `OPENROUTER_API_KEY`
in your repository secrets and commit the `.quorate.yml` generated by `init --pack solana`
to your base branch. The workflow uses `runner-mode: api`, `pack: solana`, and
`fail-on: high`, so the PR comment becomes the verified review record before any
build or preview-deploy job runs. Add `sarif-file` plus `upload-sarif` if you want
the same Solana findings in GitHub Code Scanning.

Full reference: [umutkorkmaz.github.io/quorate/docs/solana](https://umutkorkmaz.github.io/quorate/docs/solana).

## Web3 DD / Webacy

Pair `web3-dd` with `solana`, `evm`, or `move` when a dApp PR can introduce wallet
addresses, token contracts, program ids, claim URLs, approvals, raw transaction
paths, or typed-data signing changes. Static Web3 DD checks run when the pack is
selected. DD.xyz/Webacy enrichment is opt-in through `integrations.webacy` in the
base-branch `.quorate.yml`:

```yaml
integrations:
  webacy:
    enabled: true
    apiKeyEnv: WEBACY_API_KEY
    chains: [eth, base, sol]
    failOn:
      riskLevel: high
      sanctioned: true
      maliciousUrl: true
    warnOn:
      riskLevel: medium
```

Then pass the key as a normal secret:

```yaml
      - uses: UmutKorkmaz/quorate@v1.1.0
        env:
          WEBACY_API_KEY: ${{ secrets.WEBACY_API_KEY }}
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          runner-mode: api
          pack: solana,web3-dd
          fail-on: high
```

Quorate sends extracted indicators only — address, chain, or URL — not the full
source file or full diff. Full reference:
[umutkorkmaz.github.io/quorate/docs/web3-dd](https://umutkorkmaz.github.io/quorate/docs/web3-dd).

## EVM / Solidity

Quorate ships an EVM / Solidity pack with ten deterministic on-chain heuristics (tx.origin
authorization, delegatecall to untrusted targets, selfdestruct, inline assembly, block
timestamp/number dependence, unbounded loops, floating pragma, Ether send via low-level call,
unchecked low-level call return, and unchecked ERC20 transfer return) plus dedicated council
roles for EVM security, access control, reentrancy, external calls, upgrade safety, and
maintainability.

Bootstrap an EVM-ready config:

```bash
quorate init --pack evm
```

Then activate the ready-to-copy example workflow:

```bash
# copy and rename to activate
cp examples/github-workflows/quorate-evm.yml .github/workflows/quorate.yml
```

The example workflow lives at `examples/github-workflows/quorate-evm.yml` in the
[Quorate repository](https://github.com/UmutKorkmaz/quorate). Set `OPENROUTER_API_KEY`
in your repository secrets and commit the `.quorate.yml` generated by `init --pack evm`
to your base branch — that is all that is needed for real AI review on a standard
GitHub-hosted runner.

Full reference: [umutkorkmaz.github.io/quorate/docs/evm](https://umutkorkmaz.github.io/quorate/docs/evm).

## Infrastructure / IaC

Quorate ships an Infrastructure / IaC pack with ten deterministic heuristics (public storage
ACL, unrestricted ingress from 0.0.0.0/0, encryption disabled, public IP assignment, hardcoded
secrets in IaC, privileged containers, host namespace sharing, containers running as root,
privilege escalation allowed, and mutable image tags) plus dedicated council roles for IaC
security, network exposure, secrets management, identity and access, resilience, and
maintainability. Heuristics gate on `.tf`, `.yaml`, and `.yml` files so they never interfere
with Solana or EVM packs.

Bootstrap an IaC-ready config:

```bash
quorate init --pack iac
```

Then activate the ready-to-copy example workflow:

```bash
# copy and rename to activate
cp examples/github-workflows/quorate-iac.yml .github/workflows/quorate.yml
```

The example workflow lives at `examples/github-workflows/quorate-iac.yml` in the
[Quorate repository](https://github.com/UmutKorkmaz/quorate). Set `OPENROUTER_API_KEY`
in your repository secrets and commit the `.quorate.yml` generated by `init --pack iac`
to your base branch — that is all that is needed for real AI review on a standard
GitHub-hosted runner.

Full reference: [umutkorkmaz.github.io/quorate/docs/iac](https://umutkorkmaz.github.io/quorate/docs/iac).

## AI / LLM apps

Quorate ships an AI / LLM app pack with ten deterministic heuristics (untrusted input
interpolated into prompt, model output passed to code execution, model output rendered as
unsanitised HTML, unvalidated tool-call arguments, hardcoded LLM API key, LLM prompt/response
logged, model safety/moderation disabled, secret or PII included in prompt, authorisation
decision based on model output, and untrusted external content fed into prompt) plus dedicated
council roles for prompt injection, data privacy, tool safety, output safety, model governance,
and maintainability. Heuristics gate on `.py`, `.ts`, and `.js` files and map to the OWASP LLM
Top 10 and EU AI Act risk categories.

Bootstrap an LLM-app-ready config:

```bash
quorate init --pack llm
```

Then activate the ready-to-copy example workflow:

```bash
# copy and rename to activate
cp examples/github-workflows/quorate-llm.yml .github/workflows/quorate.yml
```

The example workflow lives at `examples/github-workflows/quorate-llm.yml` in the
[Quorate repository](https://github.com/UmutKorkmaz/quorate). Set `OPENROUTER_API_KEY`
in your repository secrets and commit the `.quorate.yml` generated by `init --pack llm`
to your base branch — that is all that is needed for real AI review on a standard
GitHub-hosted runner.

Full reference: [umutkorkmaz.github.io/quorate/docs/llm](https://umutkorkmaz.github.io/quorate/docs/llm).

## Move (Sui / Aptos)

Quorate ships a Move pack with ten deterministic heuristics (public entry functions, global
storage mutated without owner check, resource removed from storage, objects shared publicly,
structs with copy ability, integer downcasts, unguarded privileged functions, unchecked vector
index access, key resources with drop ability, and initializer/admin entrypoints) plus dedicated
council roles for move security, capability safety, resource safety, access control, and
maintainability. Heuristics gate on `.move` files and map to common Sui and Aptos audit findings.

Bootstrap a Move-ready config:

```bash
quorate init --pack move
```

Then activate the ready-to-copy example workflow:

```bash
# copy and rename to activate
cp examples/github-workflows/quorate-move.yml .github/workflows/quorate.yml
```

The example workflow lives at `examples/github-workflows/quorate-move.yml` in the
[Quorate repository](https://github.com/UmutKorkmaz/quorate). Set `OPENROUTER_API_KEY`
in your repository secrets and commit the `.quorate.yml` generated by `init --pack move`
to your base branch — that is all that is needed for real AI review on a standard
GitHub-hosted runner.

Full reference: [umutkorkmaz.github.io/quorate/docs/move](https://umutkorkmaz.github.io/quorate/docs/move).

## CI/CD & Supply Chain

Quorate ships a CI/CD & Supply Chain pack with ten deterministic heuristics (pull_request_target
trigger misuse, untrusted input interpolated into workflow expressions, actions not pinned to a
commit SHA, over-broad workflow permissions, self-hosted runner usage, checkouts of untrusted PR
heads, install scripts added, hardcoded registry or auth tokens, pipe-to-shell of remote scripts,
and unpinned base images or remote ADD in Dockerfiles) plus dedicated council roles for workflow
security, dependency integrity, secrets exposure, build provenance, and maintainability. Heuristics
gate on `.github/workflows` paths, `Dockerfile`, and shell scripts so they never interfere with
language-specific packs.

Bootstrap a CI-ready config:

```bash
quorate init --pack ci
```

Then activate the ready-to-copy example workflow:

```bash
# copy and rename to activate
cp examples/github-workflows/quorate-ci-supplychain.yml .github/workflows/quorate.yml
```

The example workflow lives at `examples/github-workflows/quorate-ci-supplychain.yml` in the
[Quorate repository](https://github.com/UmutKorkmaz/quorate). Set `OPENROUTER_API_KEY`
in your repository secrets and commit the `.quorate.yml` generated by `init --pack ci`
to your base branch — that is all that is needed for real AI review on a standard
GitHub-hosted runner.

Full reference: [umutkorkmaz.github.io/quorate/docs/ci](https://umutkorkmaz.github.io/quorate/docs/ci).

### SupplyChainGate in the Action

SupplyChainGate is opt-in for normal council runs. Commit the setting on the base
branch so a pull request cannot enable, disable, or weaken its own gate:

```yaml
supplyChain:
  enabled: true
  ecosystems: [npm, github-actions, docker]
  lockfiles:
    requireFor: [npm]
    onMissing: fail
```

The deterministic lane uses the unfiltered PR diff so lockfile evidence survives
AI-review budget filtering. Missing or truncated GitHub patches fail closed with a
high-severity incomplete-evidence finding. PR-controlled inline ignore comments do
not suppress SupplyChainGate; use trusted base-branch allowlists or suppression
policy for reviewed exceptions.

## Fintech / PCI

Quorate ships a Fintech / PCI pack with ten deterministic heuristics (monetary values stored as
floats, card data in logs, card number literals in source, CVV stored or persisted, webhook
signature verification disabled, floating-point arithmetic on money, financial PII in plaintext,
TLS certificate verification disabled, float rounding used for currency, and SQL built by string
concatenation on financial tables) plus dedicated council roles for payment security, PCI
compliance, data protection, transaction integrity, and maintainability. Heuristics are lightly
aligned to PCI-DSS Requirements 3, 4, 6, and 10.

Bootstrap a Fintech-ready config:

```bash
quorate init --pack fintech
```

Then activate the ready-to-copy example workflow:

```bash
# copy and rename to activate
cp examples/github-workflows/quorate-fintech.yml .github/workflows/quorate.yml
```

The example workflow lives at `examples/github-workflows/quorate-fintech.yml` in the
[Quorate repository](https://github.com/UmutKorkmaz/quorate). Set `OPENROUTER_API_KEY`
in your repository secrets and commit the `.quorate.yml` generated by `init --pack fintech`
to your base branch — that is all that is needed for real AI review on a standard
GitHub-hosted runner.

Full reference: [umutkorkmaz.github.io/quorate/docs/fintech](https://umutkorkmaz.github.io/quorate/docs/fintech).

## Healthcare / HIPAA

Quorate ships a Healthcare / HIPAA pack with ten deterministic heuristics (PHI written to logs,
PHI stored in plaintext literals, PHI in URL or query string, PHI sent to an external service,
PHI exposed in an API response, PHI sent to analytics or telemetry, patient records fetched by
user-supplied id without an entitlement check, hardcoded clinical-system credentials, over-broad
PHI queries, and weak or disabled encryption for PHI) plus dedicated council roles for PHI
protection, access auditing, data encryption, clinical safety, and maintainability. Checks are
lightly aligned to the HIPAA Security Rule Technical Safeguards at §164.312.

Bootstrap a healthcare-ready config:

```bash
quorate init --pack healthcare
```

Then activate the ready-to-copy example workflow:

```bash
# copy and rename to activate
cp examples/github-workflows/quorate-healthcare.yml .github/workflows/quorate.yml
```

The example workflow lives at `examples/github-workflows/quorate-healthcare.yml` in the
[Quorate repository](https://github.com/UmutKorkmaz/quorate). Set `OPENROUTER_API_KEY`
in your repository secrets and commit the `.quorate.yml` generated by `init --pack healthcare`
to your base branch — that is all that is needed for real AI review on a standard
GitHub-hosted runner.

Full reference: [umutkorkmaz.github.io/quorate/docs/healthcare](https://umutkorkmaz.github.io/quorate/docs/healthcare).

## Mobile (iOS / Android)

Quorate ships a Mobile (iOS / Android) pack with ten deterministic heuristics (secrets stored
in insecure local storage, hardcoded secrets in mobile source, cleartext HTTP and App Transport
Security exceptions, exported Android components without permission restrictions, WebView
JavaScript bridge enabled, TLS certificate validation disabled, sensitive data written to
device logs, debuggable build flag enabled, insecure randomness for security values, and weak
Keychain accessibility) plus dedicated council roles for insecure storage, platform configuration,
network security, cryptographic secrets, and maintainability. Heuristics are aligned to the OWASP
Mobile Application Security Verification Standard (MASVS) and gate on `.swift`, `.kt`, `.kts`,
`.m`, `.plist`, and `AndroidManifest.xml` files so they never interfere with web or backend packs.

Bootstrap a mobile-security-ready config:

```bash
quorate init --pack mobile
```

Then activate the ready-to-copy example workflow:

```bash
# copy and rename to activate
cp examples/github-workflows/quorate-mobile.yml .github/workflows/quorate.yml
```

The example workflow lives at `examples/github-workflows/quorate-mobile.yml` in the
[Quorate repository](https://github.com/UmutKorkmaz/quorate). Set `OPENROUTER_API_KEY`
in your repository secrets and commit the `.quorate.yml` generated by `init --pack mobile`
to your base branch — that is all that is needed for real AI review on a standard
GitHub-hosted runner.

Full reference: [umutkorkmaz.github.io/quorate/docs/mobile](https://umutkorkmaz.github.io/quorate/docs/mobile).

## Web & API (OWASP)

Quorate ships a Web & API pack with ten deterministic heuristics (SSRF via user-controlled URLs
in server-side requests, command injection, path traversal, reflected XSS in server-rendered
responses, open redirect, mass assignment exposing privilege fields, permissive CORS, CSRF
protection disabled on mutating endpoints, insecure deserialization of untrusted data, and weak
or broken cryptographic algorithms) plus dedicated council roles for injection, broken access
control, SSRF, authentication and session management, sensitive data exposure, and
maintainability. Heuristics map to OWASP Top 10 and OWASP API Security Top 10 categories and
gate on `.ts`, `.js`, `.py`, `.rb`, `.php`, `.go`, and `.java` files so they never interfere with
blockchain or infrastructure packs.

Bootstrap a web-security-ready config:

```bash
quorate init --pack web
```

Then activate the ready-to-copy example workflow:

```bash
# copy and rename to activate
cp examples/github-workflows/quorate-web.yml .github/workflows/quorate.yml
```

The example workflow lives at `examples/github-workflows/quorate-web.yml` in the
[Quorate repository](https://github.com/UmutKorkmaz/quorate). Set `OPENROUTER_API_KEY`
in your repository secrets and commit the `.quorate.yml` generated by `init --pack web`
to your base branch — that is all that is needed for real AI review on a standard
GitHub-hosted runner.

Full reference: [umutkorkmaz.github.io/quorate/docs/web](https://umutkorkmaz.github.io/quorate/docs/web).
