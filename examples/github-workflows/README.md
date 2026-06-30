# Example GitHub Actions workflows

These are **ready-to-copy templates**, one per Quorate domain pack. They are
intentionally kept **outside** `.github/workflows/` so GitHub does **not** run
them on this repository — GitHub executes every workflow file under
`.github/workflows/` regardless of its name, so example workflows must live here
to avoid firing redundant check runs on every pull request.

## Use one

1. Pick the pack that matches your stack (e.g. `quorate-solana.yml`).
2. Run `quorate init --pack <id>` in your repo to generate `.quorate.yml`, and
   commit it to your **base** branch (Quorate reads config from the base branch,
   never from the PR head).
3. Add `OPENROUTER_API_KEY` (or your provider key) to your repository secrets.
4. Copy the file into your repo as `.github/workflows/quorate.yml`:

   ```bash
   cp examples/github-workflows/quorate-solana.yml .github/workflows/quorate.yml
   ```

The heuristic reviewer runs with zero setup; provider keys enable full AI review.

| File | Pack | Domain |
|------|------|--------|
| `quorate-solana.yml` | `solana` | Solana / Anchor |
| `quorate-evm.yml` | `evm` | EVM / Solidity |
| `quorate-move.yml` | `move` | Move (Sui / Aptos) |
| `quorate-web3-dd.yml` | `solana,web3-dd` | Web3 DD / Webacy evidence |
| `quorate-iac.yml` | `iac` | Infrastructure / IaC |
| `quorate-llm.yml` | `llm` | AI / LLM apps |
| `quorate-ci-supplychain.yml` | `ci` | CI/CD & supply chain |
| `quorate-fintech.yml` | `fintech` | Fintech / PCI |
| `quorate-web.yml` | `web` | Web & API (OWASP) |
| `quorate-healthcare.yml` | `healthcare` | Healthcare / HIPAA |
| `quorate-mobile.yml` | `mobile` | Mobile (iOS / Android) |

> On this repository the Quorate self-review runs **GLM-5.1** (Z.ai, api mode) on GitHub-hosted runners, with the heuristic as the always-on baseline.
