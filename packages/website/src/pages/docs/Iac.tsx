import { Link } from "react-router-dom";
import { CodeBlock } from "../../components/CodeBlock";
import { InlineCode } from "../../components/InlineCode";

const HEURISTICS = [
  {
    title: "Public storage ACL",
    severity: "high",
    flags: "Storage bucket or blob container with public read/write ACL in .tf/.yaml/.yml — world-readable storage is a frequent data-exposure root cause"
  },
  {
    title: "Unrestricted ingress (0.0.0.0/0)",
    severity: "high",
    flags: "Security group, firewall rule, or network policy that allows ingress from 0.0.0.0/0 or ::/0 on any port in .tf/.yaml/.yml — exposes services to the entire internet"
  },
  {
    title: "Encryption disabled",
    severity: "medium",
    flags: "Disk, volume, or database resource with encryption explicitly disabled or unset in .tf — data at rest is unprotected if the underlying storage is compromised"
  },
  {
    title: "Public IP assignment",
    severity: "medium",
    flags: "Compute instance or node pool configured to assign a public IP address in .tf — increases attack surface; prefer private subnets with a load balancer or NAT"
  },
  {
    title: "Hardcoded secret in IaC",
    severity: "high",
    flags: "Password, token, or key literal assigned to a resource attribute in .tf/.yaml/.yml — secrets in source control are trivially exfiltrated; use a secrets manager or environment injection"
  },
  {
    title: "Privileged container",
    severity: "high",
    flags: "Container spec with privileged: true in .yaml/.yml — a privileged container has near-host access and can escape the container boundary"
  },
  {
    title: "Host namespace sharing",
    severity: "high",
    flags: "Pod spec with hostPID: true, hostIPC: true, or hostNetwork: true in .yaml/.yml — sharing host namespaces breaks container isolation and can expose host processes or networking"
  },
  {
    title: "Container runs as root",
    severity: "medium",
    flags: "Container securityContext without runAsNonRoot: true or runAsUser set to 0 in .yaml/.yml — root in a container maps to root on the host if other controls fail"
  },
  {
    title: "Privilege escalation allowed",
    severity: "medium",
    flags: "Container securityContext without allowPrivilegeEscalation: false in .yaml/.yml — a process inside the container can gain more privileges than its parent"
  },
  {
    title: "Mutable image tag (:latest)",
    severity: "low",
    flags: "Container image reference ending in :latest in .yaml/.yml — mutable tags make deployments non-deterministic and can silently pull a broken or malicious image"
  }
] as const;

export default function Iac() {
  return (
    <article className="doc-page">
      <h1>Infrastructure / IaC</h1>
      <p className="lead">
        The IaC pack brings a Terraform- and Kubernetes-aware security council and deterministic
        heuristics to Quorate. Zero-setup static checks catch the most common infrastructure
        misconfigurations before a single model is called, and a dedicated council — covering
        security posture, network exposure, secrets management, identity and access, resilience,
        and maintainability — layers semantic review on top.
      </p>

      <h2>Set up</h2>
      <p>
        Run <InlineCode>quorate init</InlineCode> with the IaC pack to scaffold the config
        and role guidance in your repo:
      </p>
      <CodeBlock language="bash">{`quorate init --pack iac`}</CodeBlock>
      <p>
        This writes a <InlineCode>.quorate.yml</InlineCode> that includes six councils
        pre-configured for Terraform and Kubernetes work:
      </p>
      <ul>
        <li>
          <strong>iac-security</strong> — public ACLs, unrestricted ingress, encryption settings,
          and public IP exposure across Terraform resources
        </li>
        <li>
          <strong>network-exposure</strong> — firewall rules, security group ingress/egress, load
          balancer configuration, and network policy scope
        </li>
        <li>
          <strong>secrets-management</strong> — hardcoded credentials, secret injection patterns,
          and secret store integration in both Terraform and Kubernetes manifests
        </li>
        <li>
          <strong>identity-access</strong> — IAM role bindings, RBAC policies, service account
          permissions, and least-privilege principle adherence
        </li>
        <li>
          <strong>resilience</strong> — replica counts, disruption budgets, health probes, and
          resource limits and requests
        </li>
        <li>
          <strong>maintainer</strong> — module versioning, image tag pinning, resource naming
          conventions, and documentation hygiene
        </li>
      </ul>
      <p>
        Each council role ships with reviewer guidance tuned to Terraform and Kubernetes idioms. Run{" "}
        <InlineCode>quorate packs</InlineCode> to see available packs and their bundled councils.
      </p>

      <h2>What it catches</h2>
      <p>
        The heuristic reviewer runs with zero setup — no model, no API key, no CLI install.
        It scans every added line in the diff against ten misconfiguration classes drawn from
        the Terraform and Kubernetes security canon. A real council (claude, codex, or any{" "}
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
        <InlineCode>quorate init --pack iac</InlineCode> to your base branch, add the workflow
        below, and set <InlineCode>OPENROUTER_API_KEY</InlineCode> in your repository secrets.
        The workflow uses <InlineCode>runner-mode: api</InlineCode> so it runs on a standard
        GitHub-hosted runner — no self-hosted machine needed.
      </p>
      <CodeBlock language="yaml">{`# .quorate.yml (base branch — generated by quorate init --pack iac)
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
    roles: [iac-security, network-exposure, secrets-management, identity-access, resilience, maintainer]`}</CodeBlock>
      <CodeBlock language="yaml">{`name: Quorate — IaC review
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
