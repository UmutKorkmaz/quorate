import { Link } from "react-router-dom";
import { CodeBlock } from "../../components/CodeBlock";
import { InlineCode } from "../../components/InlineCode";

function Checklist({ items }: { items: Array<{ title: string; steps: string; expected: string }> }) {
  return (
    <ul className="checklist">
      {items.map((item) => (
        <li key={item.title}>
          <span className="checklist-marker" aria-hidden>
            □
          </span>
          <div className="checklist-body">
            <strong>{item.title}</strong>
            <span>
              <em>Do:</em> {item.steps}
            </span>
            <br />
            <span>
              <em>Expect:</em> {item.expected}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

const TOC = [
  { id: "build", label: "0. Build sanity" },
  { id: "website", label: "1. Website" },
  { id: "emulator", label: "1b. Homepage terminal emulator" },
  { id: "onboarding", label: "2. First launch & onboarding" },
  { id: "keyboard", label: "3. Slash palette & keyboard" },
  { id: "workflow", label: "4. Core review workflow" },
  { id: "views", label: "5. Agent & settings views" },
  { id: "sessions", label: "6. Session persistence" },
  { id: "headless", label: "7. Headless CLI & CI" },
  { id: "memory", label: "8. Project memory & custom commands" },
  { id: "edge", label: "9. Classic shell & edge cases" },
  { id: "troubleshoot", label: "10. Troubleshooting" },
  { id: "walkthrough", label: "11. Suggested walkthrough" }
] as const;

export default function ManualTesting() {
  return (
    <article className="docs-content">
      <h1>Manual testing guide</h1>
      <p className="lead">
        A release checklist for Quorate's website, interactive shell, headless commands, and CI paths.
        Use it after user-facing changes or before publishing a build. Each pass is meant to be run by
        hand so keyboard flow, terminal feedback, and copy regressions do not hide behind green tests.
      </p>

      <nav className="doc-toc" aria-label="On this page">
        <p className="doc-toc-title">On this page</p>
        <ol>
          {TOC.map((item) => (
            <li key={item.id}>
              <a href={`#${item.id}`}>{item.label}</a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="test-section-note">
        <strong>Prerequisites:</strong> Node 22 or newer, git, and this repo cloned. Build the workspace
        CLI before testing so you are not validating an older global install.
        <br />
        <br />
        <strong>Recommended alias</strong> (add to your shell for the session):
        <CodeBlock language="bash">{`cd /path/to/code-council
npm run build --workspace quorate
alias quorate='node /path/to/code-council/packages/cli/dist/index.js'`}</CodeBlock>
      </div>

      <h2 id="build">0. Build sanity</h2>
      <p>Run these first. A broken build invalidates the rest of the manual pass.</p>
      <CodeBlock language="bash">{`cd code-council
npm run ci
npm run build:website`}</CodeBlock>
      <Checklist
        items={[
          {
            title: "Automated tests pass",
            steps: "Run npm run ci from the repo root.",
            expected:
              "All vitest suites green (CLI, core, website if included); TypeScript build succeeds with no errors."
          },
          {
            title: "Website production build",
            steps: "Run npm run build:website; inspect packages/website/dist/.",
            expected:
              "index.html, assets/, sitemap.xml, robots.txt, llms.txt present; no broken base path (/quorate/)."
          },
          {
            title: "CLI binary resolves",
            steps: "node packages/cli/dist/index.js --version",
            expected: "Version string prints; no module-not-found errors."
          }
        ]}
      />

      <h2 id="website">1. Website</h2>
      <p>
        Start the dev server: <InlineCode>npm run dev:website</InlineCode> then open{" "}
        <a href="http://localhost:5173/quorate/" target="_blank" rel="noreferrer">
          http://localhost:5173/quorate/
        </a>
        . For production parity, spot-check <InlineCode>npm run preview:website</InlineCode> when it is
        available.
      </p>
      <Checklist
        items={[
          {
            title: "Hero & navigation",
            steps: "Load /. Read headline, subcopy, stats row (17+ agents, 5 roles, 1 verdict).",
            expected:
              "Copy install CTA works; Live terminal demo anchor scrolls to #see-it-in-action; Manual testing link opens this page."
          },
          {
            title: "Install CTA",
            steps: "Click copy on npm install -g quorate in the hero.",
            expected: "Clipboard contains the install command; visual confirmation of copy."
          },
          {
            title: "Landing sections",
            steps:
              "Scroll: See it in action → What is Quorate → Features → Providers → Quick start → GitHub Action → FAQ.",
            expected:
              "All sections render without layout shift; provider strip animates; FAQ accordions expand/collapse."
          },
          {
            title: "Documentation hub",
            steps: "Open /docs and each sidebar page (Install through Manual testing).",
            expected:
              "All pages load; sidebar highlights active route; DocPager prev/next works between adjacent pages."
          },
          {
            title: "Commands table sync",
            steps: "Open /docs/commands; compare slash list with quorate /help in the shell.",
            expected:
              "Registry includes setup, inspect, resume, rename, compare, doctor-equivalent paths; descriptions match intent."
          },
          {
            title: "404 page",
            steps: "Visit /quorate/does-not-exist.",
            expected: "Friendly 404 with links to home and docs — not a blank Vite page."
          },
          {
            title: "SEO metadata",
            steps: "View page source on home and /docs/faq.",
            expected: "Unique title, meta description, canonical URL, Open Graph title/image/url."
          },
          {
            title: "Mobile layout",
            steps: "Resize to ~375px width or use device toolbar.",
            expected:
              "Hamburger nav opens; terminal emulator readable (no horizontal overflow); doc sidebar collapses appropriately."
          },
          {
            title: "GitHub Pages base path",
            steps: "After build, grep dist/index.html for /quorate/ asset paths.",
            expected: "JS/CSS hrefs use /quorate/ prefix so deployed site loads assets on GitHub Pages."
          }
        ]}
      />

      <h2 id="emulator">1b. Homepage terminal emulator (code-built UI)</h2>
      <p>
        The homepage demo is a <strong>React component</strong> (<InlineCode>TerminalEmulator</InlineCode>
        ), not a PNG. It should set accurate expectations for the real shell. Verify it matches what you see in{" "}
        <InlineCode>quorate</InlineCode>.
      </p>
      <div className="test-section-note">
        <strong>Interaction tips:</strong> Hover the terminal to pause auto-advance. Click phase pills
        (Welcome → Slash palette → …) to jump. Use ↻ Replay demo to restart from welcome.
      </div>
      <Checklist
        items={[
          {
            title: "Chrome & frame",
            steps: "Inspect the terminal window below the hero.",
            expected:
              "macOS-style traffic lights, title quorate — ~/Projects/my-app, Council shell badge, subtle glow and scanline overlay."
          },
          {
            title: "Phase: Welcome (~2.8s)",
            steps: "Let demo run or click Welcome pill.",
            expected:
              "QUORATE wordmark, GETTING STARTED (/git, /use available, /review), five role chips, Installed on PATH vs Active this session lines, heuristic-only footer hint."
          },
          {
            title: "Phase: Slash palette (~3.4s)",
            steps: "Watch /re type in; palette opens.",
            expected:
              "/review highlighted with ▸; /rerun and /resume listed; composer border glow; hint: ↑↓ select · Tab complete · ↵ run · Esc close."
          },
          {
            title: "Phase: Diff loaded (~2.2s)",
            steps: "Observe DiffCard after palette.",
            expected:
              "4 files changed, +128 −42; per-file lines (src/auth.ts, middleware, tests, package.json); status shows ⎇ git working tree."
          },
          {
            title: "Phase: Council running (~3.4s)",
            steps: "Watch provider rows and status line.",
            expected:
              "heuristic:maintainer ✔ 2 findings; claude:security braille running; codex:qa queued; elapsed MM:SS and esc to interrupt."
          },
          {
            title: "Phase: Verdict (~4.2s, then loops)",
            steps: "Wait for FAIL card; confirm loop restarts.",
            expected:
              "FAIL · 3 findings · agreement 67% with bar; HIGH finding at src/auth.ts:42; secondary WARN at tests/auth.test.ts:18; demo loops to Welcome."
          },
          {
            title: "Aside panel sync",
            steps: "While phases advance, read the right column in See it in action.",
            expected:
              "Current phase title/caption updates; What to verify bullets match phase; keyboard shortcut list visible; link to this guide works."
          }
        ]}
      />

      <h2 id="onboarding">2. First launch & onboarding</h2>
      <CodeBlock language="bash">cd code-council && quorate</CodeBlock>
      <p>
        For a clean onboarding pass, temporarily rename <InlineCode>.quorate.yml</InlineCode> or test in
        a fresh directory without config so the welcome state is not prefilled.
      </p>
      <Checklist
        items={[
          {
            title: "Welcome splash",
            steps: "Open quorate in a repo without .quorate.yml (or rename it temporarily).",
            expected:
              "QUORATE wordmark, GETTING STARTED card (/git, /setup, /use, /review), council role chips — visually aligned with homepage emulator."
          },
          {
            title: "Installed vs active agents",
            steps: "Read the two agent lines under the welcome card.",
            expected:
              "Installed on PATH shows green checks for detected CLIs. Active this session shows heuristic (or your enabled set) — lines are not conflated."
          },
          {
            title: "Heuristic-only hint",
            steps: "Before enabling agents, read status line and footer.",
            expected: "heuristic only → /use available appears when no real agents are active."
          },
          {
            title: "Contextual placeholder",
            steps: "With no diff loaded, read the gray placeholder in the composer.",
            expected: "Hints to try /git, /diff, or /pr — not a generic message only."
          },
          {
            title: "/setup wizard",
            steps: "Run /setup.",
            expected:
              "Step-by-step text: config check, per-agent install hints, needs-profile YAML snippets, guided /git → /use → /review."
          },
          {
            title: "/inspect",
            steps: "Run /inspect.",
            expected:
              "Config path, cwd, mode, diff label, active agents, roles, spawn status, optional QUORATE.md lines."
          },
          {
            title: "/doctor in shell",
            steps: "Run /doctor (not just /providers).",
            expected:
              "Full readiness verdict like quorate doctor CLI — Node, git, gh, per-provider state, suggested next command."
          }
        ]}
      />

      <h3>Expected onboarding snippets</h3>
      <p>These snippets are indicative. Exact wording may vary slightly by version:</p>
      <CodeBlock language="text">{`GETTING STARTED
  /git          load the working tree as a diff
  /use available enable every installed agent
  /review       convene the council on the loaded diff

Installed on PATH   N of 17 agents   claude ✔ codex ✔
Active this session heuristic ●`}</CodeBlock>

      <h2 id="keyboard">3. Slash palette & keyboard</h2>
      <Checklist
        items={[
          {
            title: "Open palette",
            steps: "Type / in the composer.",
            expected: "Filterable command list; footer shows ↑↓ select · Tab complete."
          },
          {
            title: "Prefix complete (regression)",
            steps: "Type /re then Tab.",
            expected:
              "Buffer becomes /review with trailing space; command does NOT auto-run; /clear must not win via reset alias fuzzy match."
          },
          {
            title: "Second match",
            steps: "Type /re, press ↓ once, Enter.",
            expected: "Runs /resume (or second palette row) — not /review."
          },
          {
            title: "Arg-required commands",
            steps: "Type /markdown, press Enter without a path.",
            expected: "Completes or prompts for path — does not silently no-op."
          },
          {
            title: "Input history",
            steps: "Submit two different commands, clear buffer, press ↑.",
            expected: "Prior inputs recall from transcript (when palette is closed)."
          },
          {
            title: "Shift+Tab mode cycle",
            steps: "Press Shift+Tab three times; watch status line mode.",
            expected: "Cycles review → plan → heuristic-only → review."
          },
          {
            title: "Ctrl+R search",
            steps: "Type part of a prior command, press Ctrl+R.",
            expected: "Fills matching input from history."
          },
          {
            title: "Ctrl+O copy report",
            steps: "After a completed review, press Ctrl+O.",
            expected: "Copied to clipboard or fallback path message in transcript."
          },
          {
            title: "Ctrl+L clear screen",
            steps: "With transcript content, press Ctrl+L.",
            expected: "Transcript clears visually; session state preserved."
          },
          {
            title: "Esc interrupt",
            steps: "Start /review, press Esc while running.",
            expected: "Council aborts; interrupted message in transcript; no hung spinner."
          },
          {
            title: "Queue while busy",
            steps: "During a review, type /rerun and press Tab.",
            expected: "Queued: /rerun message; command runs after current review finishes."
          },
          {
            title: "Bang shell",
            steps: "Run !git status",
            expected: "Git output in transcript without invoking the council."
          }
        ]}
      />

      <h2 id="workflow">4. Core review workflow</h2>
      <CodeBlock language="text">{`/git
/use available
/review
/last
/markdown /tmp/quorate-report.md`}</CodeBlock>
      <Checklist
        items={[
          {
            title: "Load diff",
            steps: "Run /git.",
            expected: "DiffCard with file count, +/- stats, label git working tree; status shows diff."
          },
          {
            title: "Enable agents",
            steps: "Run /use available.",
            expected: "Status active agents updates (e.g. claude+codex+heuristic); heuristic-only hint gone."
          },
          {
            title: "Council run",
            steps: "Run /review.",
            expected:
              "Spawn preview lines, per-provider RunningCard rows, braille spinner, elapsed time, esc hint."
          },
          {
            title: "Verdict report",
            steps: "Wait for completion.",
            expected:
              "PASS/WARN/FAIL header, severity cards with file:line, agreement meter; degraded badge if heuristic-only."
          },
          {
            title: "/last",
            steps: "After review completes, run /last.",
            expected: "Reprints or summarizes the most recent verdict without re-running providers."
          },
          {
            title: "Implicit diff",
            steps: "/clear then /review without /git.",
            expected: "Working tree diff loads automatically; DiffCard appears; status not no diff."
          },
          {
            title: "Export",
            steps: "/markdown /tmp/quorate-report.md then open the file.",
            expected: "Valid markdown report written to disk with verdict and findings."
          }
        ]}
      />

      <h2 id="views">5. Agent & settings views</h2>
      <Checklist
        items={[
          {
            title: "/providers grid",
            steps: "Run /providers.",
            expected: "Table with runnable, needs-profile, not installed; /use hint for needs-profile."
          },
          {
            title: "/plugins (agents)",
            steps: "Run /plugins.",
            expected: "Agent list with install hints; footer CTA for /use available."
          },
          {
            title: "/skills (roles)",
            steps: "Run /skills.",
            expected: "Read-only role descriptions; points to /roles — no fake toggle UI."
          },
          {
            title: "/settings",
            steps: "Run /settings.",
            expected: "Read-only config summary; edit .quorate.yml hint — no fake interactive controls."
          },
          {
            title: "/enable and /disable",
            steps: "/enable claude then /disable claude.",
            expected: "Active session agents change; status line reflects updates."
          },
          {
            title: "/help completeness",
            steps: "Run /help and scan all workflow groups.",
            expected:
              "Load, Agents, Review, Output, Discover, Session sections include setup, inspect, resume, history, exit."
          }
        ]}
      />

      <h2 id="sessions">6. Session persistence</h2>
      <Checklist
        items={[
          {
            title: "Auto-save after review",
            steps: "Complete a /review, exit shell, list ~/.quorate/sessions/.",
            expected: "New JSON session file under repo hash directory."
          },
          {
            title: "quorate --continue",
            steps: "Run quorate --continue from same repo.",
            expected: "Welcome shows session recap; providers/diff state restored."
          },
          {
            title: "quorate --resume <id>",
            steps: "Resume by id from /resume list.",
            expected: "Shell opens with named session context."
          },
          {
            title: "/resume picker",
            steps: "Run /resume with no args.",
            expected: "Lists saved sessions with id, name, verdict summary."
          },
          {
            title: "/rename",
            steps: "/rename auth-pr-review then /resume.",
            expected: "Session appears with new name."
          },
          {
            title: "/compare",
            steps: "After two reviews, /compare <id1> <id2>.",
            expected: "Verdict and finding delta between two runs."
          }
        ]}
      />

      <h2 id="headless">7. Headless CLI & CI</h2>
      <CodeBlock language="bash">{`quorate doctor
quorate review --diff examples/sample.diff
quorate review --diff examples/sample.diff --json 2>progress.log | tee events.ndjson
quorate plan "migrate auth to passkeys"
quorate doctor --bundle-file /tmp/quorate-diag.zip`}</CodeBlock>
      <Checklist
        items={[
          {
            title: "doctor CLI",
            steps: "quorate doctor",
            expected: "Verdict-style checklist; copy-paste fixes for needs-profile agents."
          },
          {
            title: "One-shot review",
            steps: "quorate review --diff examples/sample.diff",
            expected: "Markdown report on stdout; non-zero exit on FAIL if configured."
          },
          {
            title: "JSON stream",
            steps: "review --json; inspect stdout and progress.log.",
            expected:
              "NDJSON events on stdout (council/started, provider/*, verdict); human-readable progress on stderr."
          },
          {
            title: "Plan mode",
            steps: 'quorate plan "short architecture question"',
            expected: "Plan evaluation report; no diff required."
          },
          {
            title: "Doctor bundle",
            steps: "doctor --bundle-file /tmp/quorate-diag.zip; unzip -l.",
            expected:
              "Zip with redacted config, providers.json, doctor.txt, optional last-report.json — no raw secrets."
          },
          {
            title: "Exit codes",
            steps: "Run review on a known-fail diff with --fail-on high.",
            expected: "Process exits non-zero when severity threshold met."
          }
        ]}
      />

      <h3>Sample NDJSON events (indicative)</h3>
      <CodeBlock language="json">{`{"type":"council/started","agents":["heuristic","claude"]}
{"type":"provider/started","provider":"heuristic"}
{"type":"provider/finished","provider":"heuristic","findings":2}
{"type":"verdict","result":"fail","findings":3}`}</CodeBlock>

      <h2 id="memory">8. Project memory & custom commands</h2>
      <CodeBlock language="bash">{`mkdir -p /tmp/quorate-test && cp examples/QUORATE.md /tmp/quorate-test/
cp -r examples/.quorate /tmp/quorate-test/
cd /tmp/quorate-test && quorate`}</CodeBlock>
      <Checklist
        items={[
          {
            title: "QUORATE.md defaults",
            steps: "Launch shell in directory with examples/QUORATE.md.",
            expected: "Project defaults loaded in welcome; /inspect shows preferred roles/agents."
          },
          {
            title: "Custom slash command",
            steps: "Run custom command from .quorate/commands/ (e.g. /security-review if present).",
            expected: "Custom command appears in palette; runs council with template prompt."
          },
          {
            title: "Config precedence",
            steps: "Override one agent in .quorate.yml vs QUORATE.md hint.",
            expected: "YAML config wins; /inspect shows resolved source."
          }
        ]}
      />

      <h2 id="edge">9. Classic shell & edge cases</h2>
      <Checklist
        items={[
          {
            title: "Classic readline shell",
            steps: "quorate shell --classic",
            expected: "Plain-text loop; same slash commands work."
          },
          {
            title: "Plan mode bare text",
            steps: "In shell, /mode plan, type a plan without /.",
            expected: "Text evaluated as plan, not review."
          },
          {
            title: "NO_COLOR",
            steps: "NO_COLOR=1 quorate doctor",
            expected: "No ANSI colors; output still readable."
          },
          {
            title: "Non-TTY",
            steps: "echo /help | quorate shell --classic",
            expected: "Graceful behavior without Ink TUI crash."
          },
          {
            title: "Missing git",
            steps: "PATH=/usr/bin quorate doctor (or env without git).",
            expected: "Doctor reports git missing with actionable fix — no stack trace."
          },
          {
            title: "Wide terminal",
            steps: "Resize terminal to 200+ columns.",
            expected: "Layout does not break; long paths truncate gracefully."
          },
          {
            title: "Narrow terminal",
            steps: "Resize to 80 columns.",
            expected: "Welcome card and DiffCard remain usable; no clipped severity badges."
          }
        ]}
      />

      <h2 id="troubleshoot">10. Troubleshooting</h2>
      <div className="test-section-note">
        If something fails, capture <InlineCode>quorate doctor --bundle-file /tmp/diag.zip</InlineCode>{" "}
        and record your Node version, OS, and whether you used the workspace alias or a global install.
      </div>
      <table>
        <thead>
          <tr>
            <th>Symptom</th>
            <th>Likely cause</th>
            <th>What to try</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Tab on /re completes to /clear</td>
            <td>Alias fuzzy match ordering</td>
            <td>
              Rebuild CLI; confirm <InlineCode>matchCommands</InlineCode> prefers registry order over
              alias-only matches.
            </td>
          </tr>
          <tr>
            <td>Only heuristic runs</td>
            <td>Agents not enabled</td>
            <td>
              <InlineCode>/use available</InlineCode> or <InlineCode>/enable claude</InlineCode>; check{" "}
              <InlineCode>/doctor</InlineCode> for needs-profile.
            </td>
          </tr>
          <tr>
            <td>Provider spawn fails</td>
            <td>CLI not on PATH or missing headless profile</td>
            <td>
              Run <InlineCode>quorate doctor</InlineCode>; add YAML profile from /setup output.
            </td>
          </tr>
          <tr>
            <td>Website assets 404 on GitHub Pages</td>
            <td>Wrong base path</td>
            <td>
              Confirm Vite <InlineCode>base: '/quorate/'</InlineCode> and workflow deploys{" "}
              <InlineCode>packages/website/dist</InlineCode>.
            </td>
          </tr>
          <tr>
            <td>Ink garbled or blank</td>
            <td>Non-TTY or old terminal</td>
            <td>
              Use <InlineCode>quorate shell --classic</InlineCode> or a modern terminal (iTerm, WezTerm,
              VS Code integrated).
            </td>
          </tr>
          <tr>
            <td>Stale global quorate</td>
            <td>Testing old npm install</td>
            <td>
              Use workspace alias to <InlineCode>packages/cli/dist/index.js</InlineCode> after{" "}
              <InlineCode>npm run build --workspace quorate</InlineCode>.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="walkthrough">11. Suggested walkthrough</h2>
      <h3>45-minute release pass</h3>
      <ol className="doc-steps">
        <li>
          <strong>Build & CI (5 min)</strong>
          <span>npm run ci · build:website · CLI --version.</span>
        </li>
        <li>
          <strong>Website (10 min)</strong>
          <span>Hero, terminal emulator all phases + aside sync, doc pages, mobile nav, 404.</span>
        </li>
        <li>
          <strong>Onboarding (10 min)</strong>
          <span>quorate → /setup → /inspect → /doctor → palette Tab regression on /re.</span>
        </li>
        <li>
          <strong>Review loop (10 min)</strong>
          <span>/git → /use available → /review → /last → /markdown → Esc interrupt test.</span>
        </li>
        <li>
          <strong>Headless (5 min)</strong>
          <span>review --json, doctor --bundle, plan mode.</span>
        </li>
        <li>
          <strong>Sessions (5 min)</strong>
          <span>--continue, /resume, /rename, /compare.</span>
        </li>
      </ol>

      <h3>15-minute smoke (post-small-change)</h3>
      <ol className="doc-steps">
        <li>npm run ci</li>
        <li>Homepage emulator: palette + verdict phases</li>
        <li>quorate → /git → /review (heuristic-only OK)</li>
        <li>/re + Tab → /review</li>
      </ol>

      <p>
        Report reproducible issues on{" "}
        <a href="https://github.com/UmutKorkmaz/quorate/issues" target="_blank" rel="noreferrer">
          GitHub
        </a>
        . For automated coverage, run <InlineCode>npm run ci</InlineCode> before every manual pass.
      </p>

      <p>
        Back to <Link to="/docs/quickstart">Quick start</Link> or <Link to="/docs/commands">Slash commands</Link>.
      </p>
    </article>
  );
}
