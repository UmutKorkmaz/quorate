import { Link } from "react-router-dom";
import { CodeBlock } from "../../components/CodeBlock";
import { InlineCode } from "../../components/InlineCode";

const HEURISTICS = [
  {
    title: "Secret stored in insecure local storage",
    severity: "high",
    flags: "Value written to SharedPreferences, NSUserDefaults, AsyncStorage, or an unencrypted local database using a key that includes secret, token, password, credential, api_key, or similar — insecure local storage is world-readable on rooted or jailbroken devices and backed up to cloud by default; use the platform Keychain (iOS) or Android Keystore instead."
  },
  {
    title: "Hardcoded secret in mobile source",
    severity: "high",
    flags: "String literal assigned to a variable named api_key, apiKey, secret, password, token, private_key, or client_secret in Swift, Kotlin, Objective-C, or Java source — hardcoded secrets in mobile binaries can be extracted by static analysis tools or binary inspection without a device; inject secrets at runtime via a secure server-side token exchange, not in the compiled app."
  },
  {
    title: "Cleartext HTTP / ATS exception",
    severity: "high",
    flags: "HTTP URL with a non-HTTPS scheme used in a network request, or an NSAllowsArbitraryLoads or NSExceptionAllowsInsecureHTTPLoads entry set to true in Info.plist — cleartext traffic exposes user data to on-path attackers; use HTTPS everywhere and remove App Transport Security exceptions unless strictly required for a documented legacy endpoint."
  },
  {
    title: "Exported Android component",
    severity: "medium",
    flags: "Activity, Service, BroadcastReceiver, or ContentProvider in AndroidManifest.xml with android:exported=\"true\" and no android:permission restriction — exported components are accessible to any app on the device; add a signature-level or custom permission, or set exported to false if the component is not intended for inter-app use."
  },
  {
    title: "WebView JavaScript bridge enabled",
    severity: "medium",
    flags: "WKWebView or WebView configuration with setJavaScriptEnabled(true) combined with addJavascriptInterface or WKScriptMessageHandler that exposes native methods — a malicious or compromised page loaded in the WebView can invoke native functionality; validate the origin of every message and expose only the minimum required interface with strict input validation."
  },
  {
    title: "TLS certificate validation disabled",
    severity: "high",
    flags: "URLSession delegate, OkHttp, or NSURLConnection callback that overrides certificate validation by returning true unconditionally, calling proceed() on a SslErrorHandler, or setting a trust-all TrustManager — disabling certificate pinning or validation removes all protection against man-in-the-middle attacks; fix the underlying certificate issue rather than bypassing validation."
  },
  {
    title: "Sensitive data written to device logs",
    severity: "medium",
    flags: "NSLog, os_log, print, Log.d, Log.e, or android.util.Log call that includes a variable or field named password, token, secret, card, ssn, email, or phone — mobile logs are accessible to other apps with READ_LOGS permission and are frequently harvested in crash reports; redact or omit all sensitive data before writing to any log sink."
  },
  {
    title: "Debuggable build flag enabled",
    severity: "medium",
    flags: "android:debuggable=\"true\" in AndroidManifest.xml, or a release build configuration with DEBUG=1 or debuggable set to true — a debuggable release build allows ADB process attachment, memory dumping, and method tracing on physical devices; ensure the release variant sets debuggable to false and remove debug flags before submitting to app stores."
  },
  {
    title: "Insecure randomness for a security value",
    severity: "medium",
    flags: "Use of java.util.Random, Math.random(), arc4random(), or drand48() to generate a value used for a nonce, session token, CSRF token, salt, or encryption key — non-cryptographic random number generators are predictable and unsuitable for security-sensitive values; use SecRandomCopyBytes (iOS) or SecureRandom (Android) for all cryptographic material."
  },
  {
    title: "Weak Keychain accessibility",
    severity: "low",
    flags: "Keychain item stored with kSecAttrAccessibleAlways or kSecAttrAccessibleAlwaysThisDeviceOnly accessibility attribute — these settings allow the secret to be read while the device is locked, in the background, or after a device reboot without user authentication; prefer kSecAttrAccessibleWhenUnlockedThisDeviceOnly or kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly for credentials and tokens."
  }
] as const;

export default function Mobile() {
  return (
    <article className="doc-page">
      <h1>Mobile (iOS / Android)</h1>
      <p className="lead">
        The Mobile pack brings an iOS/Android security council and deterministic heuristics to
        Quorate. Zero-setup static checks are aligned to the OWASP Mobile Application Security
        Verification Standard (MASVS) and catch the most common mobile-specific security
        exposures before any model is called. A dedicated council — covering insecure storage,
        platform configuration, network security, cryptographic secrets, and maintainability —
        layers semantic review on top.
      </p>

      <h2>Set up</h2>
      <p>
        Run <InlineCode>quorate init</InlineCode> with the Mobile pack to scaffold the config
        and role guidance in your repo:
      </p>
      <CodeBlock language="bash">{`quorate init --pack mobile`}</CodeBlock>
      <p>
        This writes a <InlineCode>.quorate.yml</InlineCode> that includes five councils
        pre-configured for iOS and Android security:
      </p>
      <ul>
        <li>
          <strong>insecure-storage</strong> — credentials, tokens, and secrets written to
          SharedPreferences, NSUserDefaults, or unencrypted local databases instead of the
          platform Keychain or Android Keystore; weak Keychain accessibility attributes that
          allow access while the device is locked
        </li>
        <li>
          <strong>platform-config</strong> — exported Android components without permission
          restrictions, debuggable release builds, App Transport Security exceptions in
          Info.plist, and WebView JavaScript bridge exposure
        </li>
        <li>
          <strong>network-security</strong> — cleartext HTTP in network requests, disabled
          or bypassed TLS certificate validation, missing certificate pinning on
          high-value endpoints, and insecure WebView origins
        </li>
        <li>
          <strong>crypto-secrets</strong> — hardcoded secrets and API keys in Swift, Kotlin,
          Objective-C, and Java source, insecure random number generators used for
          security-sensitive values, and sensitive data written to device logs
        </li>
        <li>
          <strong>maintainer</strong> — mobile dependency hygiene, permission model review,
          long-term key and certificate rotation, and auditability of security-sensitive
          configuration changes
        </li>
      </ul>
      <p>
        Each council role ships with reviewer guidance tuned to iOS and Android threat models
        and MASVS categories. Run <InlineCode>quorate packs</InlineCode> to see available packs
        and their bundled councils.
      </p>

      <h2>What it catches</h2>
      <p>
        The heuristic reviewer runs with zero setup — no model, no API key, no CLI install.
        It scans every added line in the diff against ten mobile-specific security classes
        derived from MASVS and common iOS/Android audit findings. A real council (claude,
        codex, or any <InlineCode>type: api</InlineCode> model) then adds semantic review
        using the pack's role guidance.
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
        <InlineCode>quorate init --pack mobile</InlineCode> to your base branch, add the
        workflow below, and set <InlineCode>OPENROUTER_API_KEY</InlineCode> in your repository
        secrets. The workflow uses <InlineCode>runner-mode: api</InlineCode> so it runs on a
        standard GitHub-hosted runner — no self-hosted machine needed.
      </p>
      <CodeBlock language="yaml">{`# .quorate.yml (base branch — generated by quorate init --pack mobile)
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
    roles: [insecure-storage, platform-config, network-security, crypto-secrets, maintainer]`}</CodeBlock>
      <CodeBlock language="yaml">{`name: Quorate — Mobile (iOS / Android) review
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: UmutKorkmaz/quorate@v1.0.0
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
