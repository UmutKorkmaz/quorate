import { Link } from "react-router-dom";
import { CodeBlock } from "../../components/CodeBlock";
import { InlineCode } from "../../components/InlineCode";

const HEURISTICS = [
  {
    title: "Monetary value stored as float",
    severity: "high",
    flags: "Variable or field typed as float, double, or f64/f32 holding an amount, price, balance, or fee — floating-point representation introduces rounding error that compounds across transactions; store monetary values as integers (minor units) or an arbitrary-precision decimal type."
  },
  {
    title: "Card data in logs",
    severity: "high",
    flags: "Log statement that includes a field named card, pan, cardNumber, card_number, or similar payment-card identifier — logging raw card data violates PCI-DSS Requirement 3; strip or mask all PANs before writing to any log sink."
  },
  {
    title: "Card number literal in source",
    severity: "high",
    flags: "String literal matching the pattern of a 13–19 digit card number (Luhn-checkable ranges for Visa, Mastercard, Amex, Discover) present in source — test card numbers committed to source risk leaking into production logs or error messages; use a secrets manager or environment variable even for test data."
  },
  {
    title: "CVV stored or persisted",
    severity: "high",
    flags: "Field or variable named cvv, cvc, csc, or securityCode written to a database column, log, or serialized object — PCI-DSS Requirement 3.2 prohibits storing the card verification code after authorisation; drop the field immediately after the initial authorisation call."
  },
  {
    title: "Webhook signature verification disabled",
    severity: "medium",
    flags: "Payment webhook handler (Stripe, Adyen, PayPal, or similar) where signature verification is commented out, set to a no-op, or wrapped in a try/catch that silently continues — skipping HMAC verification allows any caller to inject fraudulent payment events; always verify before processing."
  },
  {
    title: "Floating-point arithmetic on money",
    severity: "medium",
    flags: "Arithmetic expression (addition, subtraction, multiplication, or division) applied directly to a float or double variable whose name suggests a monetary value — even a single operation can introduce a sub-cent error that accumulates; use integer minor-unit arithmetic or a decimal library instead."
  },
  {
    title: "Financial PII in plaintext",
    severity: "high",
    flags: "Field or log entry containing account_number, routing_number, iban, sort_code, ssn, tax_id, or similar financial personally identifiable information stored or transmitted without an explicit encryption wrapper — financial PII must be encrypted at rest and in transit under PCI-DSS, GDPR, and equivalent frameworks."
  },
  {
    title: "TLS certificate verification disabled",
    severity: "high",
    flags: "HTTP client configured with verify=False, rejectUnauthorized: false, InsecureSkipVerify: true, or equivalent option when connecting to a payment gateway, bank API, or fraud-detection endpoint — disabling TLS verification exposes payment credentials and card data to interception; enforce strict certificate validation on all financial API calls."
  },
  {
    title: "Float rounding used for currency",
    severity: "low",
    flags: "Call to Math.round, toFixed, round(), or printf-style rounding applied to a float that represents a currency amount — rounding a binary float does not produce exact decimal cents; convert to integer minor units before any rounding is required."
  },
  {
    title: "SQL built by string concatenation",
    severity: "high",
    flags: "SQL query assembled by string concatenation or interpolation in a file that handles transactions, balances, or payment records — string-built queries are vulnerable to SQL injection; use parameterised queries or a query builder for all financial data access."
  }
] as const;

export default function Fintech() {
  return (
    <article className="doc-page">
      <h1>Fintech / PCI</h1>
      <p className="lead">
        The Fintech pack brings a payment-security council and deterministic heuristics to Quorate.
        Zero-setup static checks catch the most common PCI-DSS violations, monetary-type mistakes,
        and data-leakage patterns before any model is called, and a dedicated council — covering
        payment security, PCI compliance, data protection, transaction integrity, and
        maintainability — layers semantic review on top. Checks are lightly aligned to PCI-DSS
        Requirements 3 (stored data), 4 (encryption in transit), 6 (injection prevention), and
        10 (logging) without requiring a formal QSA engagement.
      </p>

      <h2>Set up</h2>
      <p>
        Run <InlineCode>quorate init</InlineCode> with the Fintech pack to scaffold the config
        and role guidance in your repo:
      </p>
      <CodeBlock language="bash">{`quorate init --pack fintech`}</CodeBlock>
      <p>
        This writes a <InlineCode>.quorate.yml</InlineCode> that includes five councils
        pre-configured for payment-security and PCI-compliance work:
      </p>
      <ul>
        <li>
          <strong>payment-security</strong> — card data in logs, CVV persistence, webhook signature
          bypass, TLS verification disabled, and hardcoded card literals in test or production code
        </li>
        <li>
          <strong>pci-compliance</strong> — PCI-DSS Requirements 3, 4, 6, and 10 alignment:
          prohibited storage of sensitive authentication data, unencrypted cardholder data at rest,
          missing transport encryption, and audit-log gaps
        </li>
        <li>
          <strong>data-protection</strong> — financial PII (IBAN, routing numbers, SSNs, tax IDs)
          stored in plaintext, insufficient field-level encryption, and unmasked values in error
          responses or external API calls
        </li>
        <li>
          <strong>transaction-integrity</strong> — monetary values typed as floats, float arithmetic
          on currency fields, rounding applied to binary floats, integer overflow on minor-unit
          amounts, and SQL built by string concatenation on financial tables
        </li>
        <li>
          <strong>maintainer</strong> — schema evolution of payment tables, idempotency key usage,
          retry logic safety, and long-term auditability of financial records
        </li>
      </ul>
      <p>
        Each council role ships with reviewer guidance tuned to payment-system threat models and
        PCI-DSS idioms. Run <InlineCode>quorate packs</InlineCode> to see available packs and
        their bundled councils.
      </p>

      <h2>What it catches</h2>
      <p>
        The heuristic reviewer runs with zero setup — no model, no API key, no CLI install.
        It scans every added line in the diff against ten vulnerability classes drawn from
        common payment-security and PCI-DSS audit findings. A real council (claude, codex, or any{" "}
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
        <InlineCode>quorate init --pack fintech</InlineCode> to your base branch, add the workflow
        below, and set <InlineCode>OPENROUTER_API_KEY</InlineCode> in your repository secrets.
        The workflow uses <InlineCode>runner-mode: api</InlineCode> so it runs on a standard
        GitHub-hosted runner — no self-hosted machine needed.
      </p>
      <CodeBlock language="yaml">{`# .quorate.yml (base branch — generated by quorate init --pack fintech)
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
    roles: [payment-security, pci-compliance, data-protection, transaction-integrity, maintainer]`}</CodeBlock>
      <CodeBlock language="yaml">{`name: Quorate — Fintech / PCI review
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: UmutKorkmaz/quorate@v0.10.0
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
