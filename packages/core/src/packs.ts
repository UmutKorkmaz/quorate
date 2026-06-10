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

export const PACKS: Record<string, QuoratePack> = { solana };
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
