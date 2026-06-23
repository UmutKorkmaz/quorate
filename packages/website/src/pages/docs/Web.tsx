import { Link } from "react-router-dom";
import { CodeBlock } from "../../components/CodeBlock";
import { InlineCode } from "../../components/InlineCode";

const HEURISTICS = [
  {
    title: "SSRF — user input in a server-side request",
    severity: "high",
    flags: "HTTP client call (fetch, axios, requests, http.get, curl, or equivalent) where the URL or hostname is derived from user-supplied input without an allowlist — an attacker can redirect the request to internal services, cloud metadata endpoints (169.254.169.254), or localhost; validate and allowlist the target before making any server-side request."
  },
  {
    title: "Command injection",
    severity: "critical",
    flags: "Shell execution call (exec, spawn, system, popen, subprocess, child_process, or equivalent) where the command string or arguments include a variable that may originate from a request parameter, header, or body — unescaped user data in a shell command allows arbitrary OS command execution; avoid shell: true, use argument arrays, and never interpolate untrusted input."
  },
  {
    title: "Path traversal",
    severity: "high",
    flags: "File-system read or write call (fs.readFile, open, readFile, Path.join, send file, or equivalent) whose path is derived from user input without sanitisation — a sequence of ../ segments can escape the intended root directory and expose arbitrary files; resolve and validate the final path against the intended base directory before any file operation."
  },
  {
    title: "Reflected XSS",
    severity: "high",
    flags: "HTML template, response body, or server-rendered string where a query parameter, header value, or body field is interpolated without escaping — any unsanitised value echoed into the response allows a reflected cross-site scripting attack; use context-aware output encoding or a templating engine that escapes by default."
  },
  {
    title: "Open redirect",
    severity: "medium",
    flags: "HTTP redirect (res.redirect, Location header, window.location, or equivalent) whose destination URL is controlled by a query parameter or form field without validation — an attacker can craft a link that redirects users to a phishing site after a trusted-domain authentication flow; validate that the redirect target is on an explicit allowlist of safe origins."
  },
  {
    title: "Mass assignment",
    severity: "medium",
    flags: "ORM or model constructor call that spreads or assigns the entire request body (req.body, request.json(), params, or equivalent) to a model without an explicit field allowlist — unintended fields such as role, isAdmin, or balance can be set by a crafted request; always specify permitted attributes explicitly."
  },
  {
    title: "Permissive CORS",
    severity: "medium",
    flags: "CORS configuration that sets Access-Control-Allow-Origin to *, mirrors the request Origin header unconditionally, or combines a wildcard with Access-Control-Allow-Credentials: true — overly permissive CORS allows cross-origin requests from any domain and can expose authenticated session data; restrict allowed origins to an explicit allowlist."
  },
  {
    title: "CSRF protection disabled",
    severity: "medium",
    flags: "CSRF middleware explicitly disabled (csrf: false, csrfProtection skipped, @csrf_exempt applied, or equivalent) on a route that handles state-changing operations — removing CSRF protection allows forged cross-site requests to execute actions on behalf of authenticated users; keep CSRF tokens enabled on all mutating endpoints or use SameSite=Strict/Lax cookies combined with origin validation."
  },
  {
    title: "Insecure deserialization",
    severity: "high",
    flags: "Deserialisation call (pickle.loads, unserialize, yaml.load without SafeLoader, ObjectInputStream, or equivalent) applied to data that originates from a request body, header, cookie, or external source — deserialising untrusted data can trigger arbitrary code execution or object-injection attacks; use safe formats (JSON with schema validation) or a SafeLoader, and never deserialise data from untrusted sources with a general-purpose deserialiser."
  },
  {
    title: "Weak or broken cryptographic algorithm",
    severity: "medium",
    flags: "Use of a deprecated or broken cryptographic algorithm — MD5, SHA-1, DES, RC4, or ECB mode — for hashing passwords, signing tokens, or encrypting sensitive data; these algorithms are either collision-prone or trivially reversible and should be replaced with bcrypt/argon2 for passwords, SHA-256+ for integrity, and AES-GCM for symmetric encryption."
  }
] as const;

export default function Web() {
  return (
    <article className="doc-page">
      <h1>Web &amp; API (OWASP)</h1>
      <p className="lead">
        The Web pack brings an OWASP-aligned web security council and deterministic heuristics to
        Quorate. Zero-setup static checks catch the most common OWASP API and web vulnerabilities
        before any model is called, and a dedicated council — covering injection, broken access
        control, SSRF, authentication and session management, sensitive data exposure, and
        maintainability — layers semantic review on top. Checks map to OWASP Top 10 and OWASP API
        Security Top 10 categories not already covered by the fintech, llm, or iac packs.
      </p>

      <h2>Set up</h2>
      <p>
        Run <InlineCode>quorate init</InlineCode> with the Web pack to scaffold the config
        and role guidance in your repo:
      </p>
      <CodeBlock language="bash">{`quorate init --pack web`}</CodeBlock>
      <p>
        This writes a <InlineCode>.quorate.yml</InlineCode> that includes five councils
        pre-configured for OWASP web and API security work:
      </p>
      <ul>
        <li>
          <strong>injection</strong> — command injection, path traversal, SQL injection via
          unsanitised input, and template injection patterns in web route handlers and API
          controllers
        </li>
        <li>
          <strong>broken-access-control</strong> — mass assignment exposing privilege fields,
          missing authorisation checks on resource endpoints, insecure direct object references,
          and open redirects that bypass authentication flows
        </li>
        <li>
          <strong>ssrf</strong> — user-controlled URLs in server-side HTTP requests, cloud
          metadata endpoint reachability, and fetch calls without origin validation or allowlists
        </li>
        <li>
          <strong>auth-session</strong> — CSRF protection disabled on mutating endpoints,
          permissive CORS that exposes credentialed sessions, weak or broken cryptographic
          algorithms used for tokens or passwords, and insecure deserialization of session data
        </li>
        <li>
          <strong>data-exposure</strong> — reflected XSS in server-rendered responses,
          unescaped user input in HTML templates, and sensitive data returned in overly verbose
          error responses
        </li>
        <li>
          <strong>maintainer</strong> — input validation consistency, output encoding
          discipline, dependency hygiene for web frameworks, and long-term API versioning
          practices
        </li>
      </ul>
      <p>
        Each council role ships with reviewer guidance tuned to web and API threat models and
        OWASP idioms. Run <InlineCode>quorate packs</InlineCode> to see available packs and
        their bundled councils.
      </p>

      <h2>What it catches</h2>
      <p>
        The heuristic reviewer runs with zero setup — no model, no API key, no CLI install.
        It scans every added line in the diff against ten vulnerability classes drawn from the
        OWASP Top 10 and OWASP API Security Top 10. A real council (claude, codex, or any{" "}
        <InlineCode>type: api</InlineCode> model) then adds semantic review using the pack's
        role guidance.
      </p>
      <table>
        <thead>
          <tr>
            <th>Heuristic</th>
            <th>Severity</th>
            <th>What it flags</th>
          </tr>
        </thead>
        <tbody>
          {HEURISTICS.map((h) => (
            <tr key={h.title}>
              <td>
                <strong>{h.title}</strong>
              </td>
              <td>
                <InlineCode>{h.severity}</InlineCode>
              </td>
              <td>{h.flags}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        A heuristic-only review is reported as <strong>degraded</strong> — an honest WARN, never
        a confident green. Add a council provider to get full semantic coverage.
      </p>

      <h2>On every PR</h2>
      <p>
        Commit the <InlineCode>.quorate.yml</InlineCode> scaffolded by{" "}
        <InlineCode>quorate init --pack web</InlineCode> to your base branch, add the workflow
        below, and set <InlineCode>OPENROUTER_API_KEY</InlineCode> in your repository secrets.
        The workflow uses <InlineCode>runner-mode: api</InlineCode> so it runs on a standard
        GitHub-hosted runner — no self-hosted machine needed.
      </p>
      <CodeBlock language="yaml">{`# .quorate.yml (base branch — generated by quorate init --pack web)
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
    roles: [injection, broken-access-control, ssrf, auth-session, data-exposure, maintainer]`}</CodeBlock>
      <CodeBlock language="yaml">{`name: Quorate — Web & API (OWASP) review
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: UmutKorkmaz/quorate@v0.9.0
        env:
          OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}
          runner-mode: api`}</CodeBlock>
      <p>
        The heuristic always runs regardless of <InlineCode>runner-mode</InlineCode>. Swap the
        OpenRouter model for any OpenAI-compatible endpoint — see{" "}
        <Link to="/docs/providers">Providers</Link> for presets and the{" "}
        <InlineCode>quorate provider add</InlineCode> command. For general Action options
        (inline comments, <InlineCode>fail-on</InlineCode>, agreement gate) see{" "}
        <Link to="/docs/github-action">GitHub Action</Link>.
      </p>
    </article>
  );
}
