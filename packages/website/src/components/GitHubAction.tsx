import { useCallback, useState } from "react";
import { Section } from "./Section";

const YAML_SNIPPET = `name: Quorate
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: UmutKorkmaz/quorate@v0.5.0
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}`;

export function GitHubAction() {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(YAML_SNIPPET);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, []);

  return (
    <Section
      id="github-action"
      eyebrow="CI/CD"
      title="Run the council on every PR"
      description="The Action posts a single report comment and can fail the check based on fail-on severity. Use a self-hosted runner when the bot should call locally authenticated CLIs."
    >
      <div className="grid gap-8 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="overflow-hidden rounded-xl border border-quorate-border bg-quorate-surface shadow-(--shadow-terminal)">
            <div className="flex items-center justify-between border-b border-quorate-border bg-quorate-elevated/60 px-4 py-3">
              <span className="font-mono text-xs text-quorate-dim">.github/workflows/quorate.yml</span>
              <button
                type="button"
                onClick={copy}
                className="rounded border border-quorate-border bg-quorate-surface px-2.5 py-1 font-mono text-xs text-quorate-muted transition hover:border-quorate-accent/40 hover:text-quorate-accent"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-quorate-muted">
              <code>{YAML_SNIPPET}</code>
            </pre>
          </div>
        </div>
        <div className="flex flex-col justify-center gap-4 lg:col-span-2">
          <div className="rounded-xl border border-quorate-border bg-quorate-elevated/40 p-5">
            <h3 className="font-semibold text-quorate-pass">Secure by default</h3>
            <p className="mt-2 text-sm leading-relaxed text-quorate-muted">
              The Action loads <code className="text-quorate-accent">.quorate.yml</code> from the
              pull request's <strong className="text-white">base branch</strong> — a PR cannot
              supply the config that governs its own review.
            </p>
          </div>
          <div className="rounded-xl border border-quorate-border bg-quorate-elevated/40 p-5">
            <h3 className="font-semibold text-quorate-amber">Runner modes</h3>
            <p className="mt-2 text-sm leading-relaxed text-quorate-muted">
              GitHub-hosted runners use the built-in heuristic. Self-hosted runners can invoke
              locally authenticated CLIs like <code className="text-quorate-accent">claude</code> and{" "}
              <code className="text-quorate-accent">codex</code>.
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}