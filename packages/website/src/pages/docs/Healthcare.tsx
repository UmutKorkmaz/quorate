import { Link } from "react-router-dom";
import { CodeBlock } from "../../components/CodeBlock";
import { InlineCode } from "../../components/InlineCode";

const HEURISTICS = [
  {
    title: "PHI written to logs",
    severity: "high",
    flags: "Log statement that includes a field named patient, patientId, patient_id, mrn, dob, date_of_birth, diagnosis, ssn, or similar protected health identifier — logging PHI violates HIPAA Security Rule §164.312 and creates audit liability; mask or omit all PHI before writing to any log sink."
  },
  {
    title: "PHI stored in plaintext literal",
    severity: "high",
    flags: "String literal or hardcoded value that contains a recognisable PHI identifier such as mrn, dob, diagnosis, icd_code, npi, or a Social Security Number pattern — test PHI committed to source can leak into production logs or error messages; use anonymised synthetic data or a secrets manager even for test fixtures."
  },
  {
    title: "PHI in URL or query string",
    severity: "medium",
    flags: "URL construction or query-string parameter that includes a patient identifier, medical record number, date of birth, or similar PHI field — PHI in URLs appears in server access logs, browser history, Referer headers, and proxy caches; route patient-specific data through POST bodies or encrypted tokens instead."
  },
  {
    title: "PHI sent to an external service",
    severity: "medium",
    flags: "HTTP client call (fetch, axios, requests, http.get, or equivalent) that includes a variable or field named patient, mrn, dob, diagnosis, or similar PHI identifier in the request body or headers sent to an external or third-party endpoint — PHI may only be transmitted to covered entities or business associates under a signed BAA; verify the recipient is authorised before including protected data."
  },
  {
    title: "PHI exposed in an API response",
    severity: "medium",
    flags: "API response or JSON serialisation that returns a patient record, clinical note, diagnosis code, or other PHI field without an explicit access-control check on the authenticated user's entitlement to that record — returning unrestricted PHI violates the minimum-necessary principle under HIPAA §164.514(b); filter response fields to what the caller is authorised to receive."
  },
  {
    title: "PHI sent to analytics or telemetry",
    severity: "medium",
    flags: "Analytics or telemetry call (Segment, Mixpanel, DataDog, Sentry, or equivalent) that includes a property or context field containing patient, mrn, userId mapped to a patient, or clinical attributes — telemetry platforms are rarely covered under a HIPAA BAA; strip or pseudonymise all PHI before passing events to external analytics."
  },
  {
    title: "Patient record fetched by user-supplied id",
    severity: "medium",
    flags: "Database query or ORM lookup that retrieves a patient or clinical record using an id value drawn directly from a request parameter, query string, or body without an explicit authorisation check that the authenticated user is entitled to that record — insecure direct object reference on patient records violates HIPAA minimum-necessary access and OWASP API2; verify ownership or role entitlement before executing the lookup."
  },
  {
    title: "Hardcoded clinical-system credential",
    severity: "high",
    flags: "String literal that resembles an API key, password, or connection string for a clinical system — EHR, FHIR server, HL7 endpoint, PACS, or lab interface credential hardcoded in source can be extracted from build artefacts and used to access patient records without audit trail; store clinical-system credentials in a secrets manager and inject at runtime."
  },
  {
    title: "Over-broad PHI query",
    severity: "low",
    flags: "Database query or ORM call on a patient, clinical_note, encounter, or diagnosis table that fetches all rows or a large unbounded result set without a patient-scoped WHERE clause or a LIMIT constraint — over-broad queries return more PHI than required, violating the HIPAA minimum-necessary standard and creating unnecessary data-breach surface; scope queries to the authorised patient or add an explicit row limit."
  },
  {
    title: "Weak or disabled encryption for PHI",
    severity: "medium",
    flags: "Encryption configuration for a storage field, database column, or file containing PHI that uses a deprecated algorithm (DES, 3DES, RC4, or MD5/SHA-1 for key derivation), disables encryption (encrypted: false, encrypt: none), or uses a key size below 128 bits — HIPAA Security Rule §164.312(a)(2)(iv) requires addressable encryption of PHI at rest; use AES-256-GCM or an equivalent NIST-approved cipher with proper key management."
  }
] as const;

export default function Healthcare() {
  return (
    <article className="doc-page">
      <h1>Healthcare / HIPAA</h1>
      <p className="lead">
        The Healthcare pack brings a PHI-protection council and deterministic heuristics to
        Quorate. Zero-setup static checks catch the most common HIPAA-related PHI exposures and
        access-control gaps before any model is called, and a dedicated council — covering PHI
        protection, access auditing, data encryption, clinical safety, and maintainability —
        layers semantic review on top. Checks are lightly aligned to the HIPAA Security Rule
        (45 CFR Part 164) — in particular the Technical Safeguards at §164.312 covering access
        control, audit controls, integrity, and transmission security — without replacing a
        formal HIPAA risk analysis or compliance programme.
      </p>

      <h2>Set up</h2>
      <p>
        Run <InlineCode>quorate init</InlineCode> with the Healthcare pack to scaffold the config
        and role guidance in your repo:
      </p>
      <CodeBlock language="bash">{`quorate init --pack healthcare`}</CodeBlock>
      <p>
        This writes a <InlineCode>.quorate.yml</InlineCode> that includes five councils
        pre-configured for healthcare security and HIPAA compliance work:
      </p>
      <ul>
        <li>
          <strong>phi-protection</strong> — PHI written to logs or analytics sinks, PHI
          exposed in API responses beyond the minimum-necessary standard, PHI in URL query
          strings, and PHI transmitted to external services not covered by a BAA
        </li>
        <li>
          <strong>access-audit</strong> — patient records fetched by user-supplied identifiers
          without entitlement checks, over-broad queries returning more PHI than authorised,
          missing audit-log entries on PHI reads and writes, and insecure direct object
          references on clinical resources
        </li>
        <li>
          <strong>data-encryption</strong> — PHI stored in plaintext literals or unencrypted
          columns, hardcoded clinical-system credentials (EHR, FHIR, HL7, PACS), weak or
          disabled encryption algorithms for PHI at rest, and missing transport-layer
          encryption on clinical API calls
        </li>
        <li>
          <strong>clinical-safety</strong> — unsafe handling of ICD/SNOMED codes and dosage
          values, integer or float arithmetic on clinical measurements without unit validation,
          missing null checks on critical clinical fields, and ambiguous boolean flags on
          patient-status records
        </li>
        <li>
          <strong>maintainer</strong> — PHI data-model evolution, consent and authorisation
          record hygiene, retention and deletion policy hooks, and long-term auditability of
          clinical transactions
        </li>
      </ul>
      <p>
        Each council role ships with reviewer guidance tuned to healthcare threat models and
        HIPAA Security Rule idioms. Run <InlineCode>quorate packs</InlineCode> to see available
        packs and their bundled councils.
      </p>

      <h2>What it catches</h2>
      <p>
        The heuristic reviewer runs with zero setup — no model, no API key, no CLI install.
        It scans every added line in the diff against ten PHI-exposure and access-control classes
        derived from common HIPAA audit findings and the HIPAA Security Rule Technical Safeguards.
        A real council (claude, codex, or any{" "}
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
        <InlineCode>quorate init --pack healthcare</InlineCode> to your base branch, add the
        workflow below, and set <InlineCode>OPENROUTER_API_KEY</InlineCode> in your repository
        secrets. The workflow uses <InlineCode>runner-mode: api</InlineCode> so it runs on a
        standard GitHub-hosted runner — no self-hosted machine needed.
      </p>
      <CodeBlock language="yaml">{`# .quorate.yml (base branch — generated by quorate init --pack healthcare)
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
    roles: [phi-protection, access-audit, data-encryption, clinical-safety, maintainer]`}</CodeBlock>
      <CodeBlock language="yaml">{`name: Quorate — Healthcare / HIPAA review
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: UmutKorkmaz/quorate@1e7796b0f86cdbacadf149637c87b9812b246303
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
