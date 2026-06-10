/** Ecosystem pack registry (solana first) — councils + per-role guidance. */
import type { DetectedProvider, QuorateConfig } from "./types.js";
import { createDefaultConfig } from "./providers.js";

export interface QuoratePack {
  id: string;
  description: string;
  councils: string[];
  roleGuidance: Record<string, string>;
}

const solana: QuoratePack = {
  id: "solana",
  description: "Solana / Anchor security review council",
  councils: [
    "solana-security",
    "anchor-accounts",
    "transaction-safety",
    "token-safety",
    "maintainer"
  ],
  roleGuidance: {
    "solana-security":
      "Audit every instruction for missing signer/owner checks and privilege-escalation paths. Scrutinise cross-program invocations (CPI) for arbitrary program-id acceptance, unchecked return values, and re-entrancy risks.",
    "anchor-accounts":
      "Review all #[account(...)] constraints, ensuring has_one, seeds, and bump are correctly specified. Flag every use of UncheckedAccount or AccountInfo that lacks a manual safety comment explaining why the constraint is safe.",
    "transaction-safety":
      "Check that skipPreflight is never set to true in production paths and that blockhash freshness and commitment levels are appropriate. Verify fee-payer selection and confirm that simulation results are checked before sending.",
    "token-safety":
      "Validate SPL token mint addresses, token-account ownership, and decimal precision before any arithmetic involving amounts. Confirm that Associated Token Account (ATA) derivation and ownership are verified, not assumed.",
    "maintainer":
      "Assess overall code structure, test coverage, and upgrade path safety. Identify dead code, unclear error messages, missing integration tests, and any patterns that will make the program hard to audit or extend."
  }
};

const evm: QuoratePack = {
  id: "evm",
  description: "EVM / Solidity security review council",
  councils: [
    "evm-security",
    "access-control",
    "reentrancy",
    "external-calls",
    "upgrade-safety",
    "maintainer"
  ],
  roleGuidance: {
    "evm-security":
      "Audit every Solidity file for tx.origin authentication, delegatecall to untrusted targets, selfdestruct usage, and unsafe inline assembly. Flag any pattern that bypasses EVM safety guarantees or exposes the contract to phishing or storage-collision attacks.",
    "access-control":
      "Verify that all state-changing functions are protected by onlyOwner, role-based access control, or explicit initializer guards. Confirm that initializers cannot be called twice and that privilege-granting functions are not exposed to arbitrary callers.",
    "reentrancy":
      "Enforce checks-effects-interactions ordering on every external call. Flag any function that sends ether or calls an external contract before finalising its own state updates, and confirm that nonReentrant guards are in place where needed.",
    "external-calls":
      "Review all low-level .call, .delegatecall, and ERC20 transfer/transferFrom invocations. Ensure return values are always checked, gas limits are considered, and the push-payment pattern is used to avoid DoS via gas-griefing.",
    "upgrade-safety":
      "Inspect proxied or upgradeable contracts for storage layout collisions, missing storage gaps in base contracts, double-initializer risks, and the use of immutable variables in proxy contexts. Confirm that the upgrade path is access-controlled.",
    "maintainer":
      "Assess overall code structure, test coverage, compiler version pinning, and long-term maintainability. Identify dead code, unclear error messages, missing natspec, and any patterns that will make the contract hard to audit or extend."
  }
};

const iac: QuoratePack = {
  id: "iac",
  description: "Infrastructure-as-Code (Terraform / Kubernetes) security review council",
  councils: [
    "iac-security",
    "network-exposure",
    "secrets-management",
    "identity-access",
    "resilience",
    "maintainer"
  ],
  roleGuidance: {
    "iac-security":
      "Audit all Terraform and Kubernetes manifests for general security posture. Look for insecure defaults, missing security contexts, and configurations that deviate from least-privilege principles. Verify that every resource has appropriate tags, labels, and metadata for traceability.",
    "network-exposure":
      "Review all network configuration for overly permissive ingress rules. Flag any use of 0.0.0.0/0 CIDR blocks in security groups, network ACLs, or firewall rules. Identify publicly accessible storage buckets (public ACLs), public IP assignments, and load balancers exposed without restriction. Ensure private subnets are used for sensitive workloads.",
    "secrets-management":
      "Detect plaintext secrets, passwords, access keys, and private keys hardcoded in Terraform variables, resource arguments, or Kubernetes manifests. Flag unencrypted storage volumes, databases without encryption-at-rest, and any secret stored as a plain ConfigMap instead of a Secret or external secrets manager reference.",
    "identity-access":
      "Scrutinise IAM roles and policies for over-broad permissions (wildcard actions or resources). In Kubernetes, flag privileged containers, containers running as root (runAsUser: 0 or runAsNonRoot: false), allowPrivilegeEscalation: true, and host namespace sharing (hostNetwork, hostPID, hostIPC). Enforce least-privilege for all service accounts and pod security contexts.",
    "resilience":
      "Check for missing CPU and memory resource limits on containers, which can cause noisy-neighbour DoS. Flag mutable image tags (:latest) that break reproducible deployments. Identify single-replica deployments for critical services that require high availability. Verify health probes (liveness, readiness) are configured.",
    "maintainer":
      "Assess overall code structure, module reuse, and long-term maintainability of the IaC. Identify duplicated resource blocks, missing output descriptions, unclear variable names, and lack of comments explaining non-obvious configuration choices. Check that modules are versioned and that the code is organised for team-scale use."
  }
};

const llm: QuoratePack = {
  id: "llm",
  description: "AI / LLM application security review council",
  councils: [
    "prompt-injection",
    "data-privacy",
    "tool-safety",
    "output-safety",
    "model-governance",
    "maintainer"
  ],
  roleGuidance: {
    "prompt-injection":
      "Audit every location where untrusted content — user input, fetched web pages, database records, third-party API responses — is concatenated into a prompt or system message. Flag any pattern that allows attacker-controlled content to override the system prompt, inject new instructions, or hijack the model's persona. Pay close attention to template literals and string interpolation that embed raw input without sanitisation or escaping.",
    "data-privacy":
      "Identify secrets, API keys, personally-identifiable information (PII), and other sensitive data that are included in prompts or logged alongside prompt/response pairs. Flag hardcoded LLM API keys (OpenAI sk-, Anthropic sk-ant-, Google AIza*). Verify that prompt and response logging is intentional, scoped, and complies with data-retention obligations. Ensure sensitive fields are redacted before being forwarded to a model.",
    "tool-safety":
      "Review every location where model-generated content — tool-call arguments, function-call JSON, completion text — is passed to code execution paths such as eval, new Function, exec, execSync, or spawn. Verify that tool-call arguments are schema-validated before use, that the model cannot self-invoke dangerous tools, and that any shell or filesystem operations gated on model output are independently authorised.",
    "output-safety":
      "Audit rendering paths that take model output and emit it as HTML or inject it into the DOM. Flag dangerouslySetInnerHTML, innerHTML assignment, or document.write calls that use completion text without prior sanitisation. Identify authorization or access-control decisions (if/switch/ternary) that are resolved by comparing model output strings, which can be manipulated by prompt injection.",
    "model-governance":
      "Check that moderation, safety filters, and content-policy settings are enabled and not overridden to 'none', false, or BLOCK_NONE. Flag model swaps, provider changes, or version pins that lack accompanying evaluation results. Confirm that rate limits, retry logic, and fallback behaviour are in place and that model configuration is managed through code review rather than ad-hoc changes.",
    "maintainer":
      "Assess overall code structure, test coverage, observability, and long-term maintainability of the LLM integration. Identify missing input-validation layers, absent unit tests for prompt-construction logic, unclear error messages from model calls, and any patterns that will make the AI feature hard to audit, debug, or extend."
  }
};

const move: QuoratePack = {
  id: "move",
  description: "Move (Sui / Aptos) smart-contract security review council",
  councils: [
    "move-security",
    "capability-safety",
    "resource-safety",
    "access-control",
    "maintainer"
  ],
  roleGuidance: {
    "move-security":
      "Audit every public entry function for missing caller-authorization checks — entry functions are externally callable by any account and must explicitly verify the signer. Review shared-object exposure in Sui: objects passed as &mut through shared_object transfer are accessible to any transaction and require careful mutation guards.",
    "capability-safety":
      "Inspect all capability types (AdminCap, MintCap, etc.) for leakage paths — capabilities must not be transferred to untrusted accounts or stored in world-readable locations. Verify that every privileged function is gated by a capability parameter or signer check rather than relying on call-site convention.",
    "resource-safety":
      "Review struct ability declarations (key, store, copy, drop) for correctness: value resources representing authority or assets must not carry copy (duplicable) or drop (silently destroyable) abilities. Audit every borrow_global_mut and move_from call to confirm the caller's address equals signer::address_of(account) before accessing or removing a stored resource.",
    "access-control":
      "Verify that every function performing privileged operations (withdraw, mint, burn, admin actions) performs an explicit signer::address_of check or requires a capability argument. Confirm that init / one-time admin functions are protected from re-invocation and that AdminCap issuance is restricted to the deployer.",
    "maintainer":
      "Assess overall code structure, test coverage, module upgrade path, and long-term maintainability. Identify dead code, unclear error codes, missing unit tests for critical functions, and any patterns that will make the module hard to audit or extend."
  }
};

export const PACKS: Record<string, QuoratePack> = { solana, evm, iac, llm, move };
export const PACK_IDS = Object.keys(PACKS);

/**
 * Build a QuorateConfig seeded from a pack.
 *
 * - Starts from createDefaultConfig(detected) so all provider meta-data
 *   (command, args, inputMode, timeoutMs, …) comes from the existing logic.
 * - Overrides councils and roleGuidance with pack values.
 * - Re-assigns pack councils (minus "maintainer") to real providers round-robin,
 *   2 roles per provider.  The heuristic/mock provider always gets ["maintainer"].
 */
export function buildPackConfig(
  pack: QuoratePack,
  detected: DetectedProvider[]
): QuorateConfig {
  const base = createDefaultConfig(detected);

  // Councils that should be distributed among real (non-mock) providers.
  const distributedCouncils = pack.councils.filter((c) => c !== "maintainer");

  // Split providers into mock (heuristic) and real.
  const mockProviders = base.providers.filter((p) => p.type === "mock");
  const realProviders = base.providers.filter((p) => p.type !== "mock");

  // Assign pack councils to real providers round-robin, 2 per provider.
  const updatedRealProviders = realProviders.map((provider, index) => {
    const chunkStart = index * 2;
    const roles = distributedCouncils.slice(chunkStart, chunkStart + 2);
    // If we've run out of distributed councils give the provider at least one
    // from the pack so the array is never empty.
    const finalRoles = roles.length > 0 ? roles : [distributedCouncils[index % distributedCouncils.length]];
    return { ...provider, roles: finalRoles };
  });

  // Mock providers always carry "maintainer".
  const updatedMockProviders = mockProviders.map((provider) => ({
    ...provider,
    roles: ["maintainer"]
  }));

  return {
    ...base,
    councils: pack.councils,
    roleGuidance: pack.roleGuidance,
    providers: [...updatedMockProviders, ...updatedRealProviders]
  };
}
