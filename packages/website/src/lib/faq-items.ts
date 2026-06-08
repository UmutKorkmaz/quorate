export const DOC_FAQ_ITEMS = [
  {
    question: "Do I need API keys?",
    answer:
      "No. Quorate drives the AI CLIs you already have installed locally — claude, codex, qwen, kimi, and others. It detects them on your PATH and runs them in headless mode. No API keys to wire up for CLI providers."
  },
  {
    question: "What runs if I don't enable any providers?",
    answer:
      "The built-in heuristic reviewer runs with zero setup. It performs four fast static checks (focused tests, hard-coded secrets, stray console.log, TODO/FIXME). The result is always reported as degraded — never a confident green pass."
  },
  {
    question: "What does degraded mean?",
    answer:
      "A degraded review is one where no real (cli/api) provider finished successfully, so the verdict rests on the heuristic alone. Quorate never shows a confident green for it: a would-be PASS is downgraded to WARN, and the shell, Markdown report, and PR comment all label it heuristic-only."
  },
  {
    question: "Why did my review come back degraded even with providers enabled?",
    answer:
      "The enabled providers ran but none succeeded. Common causes: the agent isn't authenticated or doesn't support headless/stdin; its configured args are wrong for the installed version; or a provider hit an explicit maxInputBytes limit you set in .quorate.yml (there is no input cap by default). /git already excludes lockfiles and other generated files from the diff, so size is rarely the issue now. Run /inspect or quorate doctor to check spawn readiness, and /provider <id> to audit a provider's exact command."
  },
  {
    question: "Can I use local or hosted API models instead of CLIs?",
    answer:
      "Yes. Add a provider with type: api pointing at any OpenAI-compatible endpoint (Ollama, llama.cpp, LM Studio, vLLM, or a hosted gateway). model is required; baseUrl is optional and defaults to http://localhost:11434/v1; an optional apiKeyEnv names the environment variable holding the key. See the Configuration guide."
  },
  {
    question: "How do I enable multiple AI reviewers?",
    answer:
      "In the shell, run /use available to enable every detected, runnable CLI for the session. To persist providers, run quorate init and edit .quorate.yml — or use quorate provider add <id> (with --preset for common endpoints) to write the entry for you."
  },
  {
    question: "How do I control which agent reviews which role (qa, security, …)?",
    answer:
      "Each provider's roles: array assigns it to council voices — e.g. claude roles: [security, architect], codex roles: [qa, maintainer]. For different models per role, define separate providers and give each its roles. /skills shows the current routing; /route <role> <providers> reassigns it for one session (/route reset to undo); quorate provider add --roles writes it to .quorate.yml."
  },
  {
    question: "Can I run real model review in CI without a self-hosted runner?",
    answer:
      "Yes. Commit a .quorate.yml on your base branch with a type: api provider pointing at a hosted gateway (OpenRouter, Hugging Face router, …), pass the key through as an env var from secrets, and set runner-mode: api. API providers run on standard GitHub-hosted runners; only type: cli agents (claude, codex) need a self-hosted runner. See the GitHub Action docs."
  },
  {
    question: "Is it safe to run AI CLIs on my code?",
    answer:
      "Quorate is designed for safety: real providers are opt-in, spawned without a shell (no shell injection), with explicit headless arguments, byte/time caps, a dangerous-flag denylist, and a scrubbed environment built from an allowlist."
  },
  {
    question: "Why does the GitHub Action read config from the base branch?",
    answer:
      "Security. Loading .quorate.yml from the PR head would let an attacker supply the configuration that governs their own review. The Action always uses the base branch config so pull requests cannot escalate privileges."
  },
  {
    question: "Can I use self-hosted runners with the Action?",
    answer:
      "Yes. Use a self-hosted runner when the bot should call locally authenticated CLIs (claude, codex, etc.). GitHub-hosted runners work for the default heuristic reviewer without any local CLI installs."
  },
  {
    question: "What Node version do I need?",
    answer: "Node ≥ 22. Run quorate doctor to verify your environment."
  },
  {
    question: "How do I review a pull request locally?",
    answer:
      "In the shell, run /pr 123 (requires gh CLI) to load the PR diff, then /review. Or use quorate review --base main --head HEAD to review your current branch against main."
  },
  {
    question: "How do I export a report?",
    answer:
      "After a review, use /json path or /markdown path in the shell to save the last report. You can also view it again with /last or re-run with /rerun."
  }
] as const;

export const faqPageJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: DOC_FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.answer
    }
  }))
};