import { useCallback, useState } from "react";

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
      - uses: UmutKorkmaz/quorate@v0.7.0
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
    <section id="github-action" className="relative px-6 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="reveal is-visible">
          <div className="mb-4 flex items-center gap-3">
            <span
              className="h-px w-6 rounded-full"
              style={{
                background:
                  "linear-gradient(90deg, rgba(110,151,255,0.7), rgba(110,151,255,0.2))"
              }}
              aria-hidden
            />
            <p className="font-mono text-xs tracking-[0.2em] text-quorate-accent uppercase">
              CI/CD
            </p>
          </div>
          <h2 className="display-section text-3xl text-white md:text-4xl">
            Run the council on every PR
          </h2>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-quorate-muted">
            The Action posts a single report comment and can fail the check based on fail-on
            severity. Use a self-hosted runner when the bot should call locally authenticated CLIs.
          </p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <div className="overflow-hidden rounded-2xl border border-quorate-border bg-quorate-surface/60 shadow-terminal backdrop-blur">
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
            <div className="rounded-2xl border border-quorate-border bg-quorate-surface/60 p-5 backdrop-blur">
              <h3 className="font-semibold text-quorate-pass">Secure by default</h3>
              <p className="mt-2 text-sm leading-relaxed text-quorate-muted">
                The Action loads <code className="text-quorate-accent">.quorate.yml</code> from the
                pull request's <strong className="text-white">base branch</strong> — a PR cannot
                supply the config that governs its own review.
              </p>
            </div>
            <div className="rounded-2xl border border-quorate-border bg-quorate-surface/60 p-5 backdrop-blur">
              <h3 className="font-semibold text-quorate-amber">Runner modes</h3>
              <p className="mt-2 text-sm leading-relaxed text-quorate-muted">
                GitHub-hosted runners use the built-in heuristic. Self-hosted runners can invoke
                locally authenticated CLIs like <code className="text-quorate-accent">claude</code> and{" "}
                <code className="text-quorate-accent">codex</code>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}