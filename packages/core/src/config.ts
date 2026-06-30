import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { createDefaultConfig } from "./providers.js";
import type { QuorateConfig } from "./types.js";

const severitySchema = z.enum(["critical", "high", "medium", "low", "info"]);

const providerSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["cli", "api", "mock"]).default("cli"),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).default([]),
  roles: z.array(z.string().min(1)).default([]),
  enabled: z.boolean().default(false),
  timeoutMs: z.number().int().positive().default(120_000),
  killGraceMs: z.number().int().positive().default(5_000),
  stdin: z.boolean().default(true),
  inputMode: z.enum(["stdin", "prompt-file", "none"]).optional(),
  maxInputBytes: z.number().int().positive().optional(),
  maxOutputBytes: z.number().int().positive().default(1_000_000),
  allowDangerousArgs: z.boolean().default(false),
  headlessAllowlist: z.array(z.string().min(1)).optional(),
  inheritEnv: z.boolean().default(false),
  envAllowlist: z.array(z.string().min(1)).optional(),
  env: z.record(z.string(), z.string()).optional(),
  installHint: z.string().optional(),
  baseUrl: z.string().url().optional(),
  model: z.string().min(1).optional(),
  apiKeyEnv: z.string().min(1).optional(),
  cost: z
    .object({
      inputUsdPer1M: z.number().nonnegative().optional(),
      outputUsdPer1M: z.number().nonnegative().optional()
    })
    .optional()
});

const webacyRiskLevelSchema = z.enum(["low", "medium", "high"]);

const webacySchema = z
  .object({
    enabled: z.boolean().default(false),
    apiKeyEnv: z.string().min(1).default("WEBACY_API_KEY"),
    chains: z.array(z.string().min(1)).default(["eth", "base", "sol"]),
    failOn: z
      .object({
        riskLevel: webacyRiskLevelSchema.optional(),
        sanctioned: z.boolean().optional(),
        maliciousUrl: z.boolean().optional()
      })
      .default({ riskLevel: "high", sanctioned: true, maliciousUrl: true }),
    warnOn: z
      .object({
        riskLevel: webacyRiskLevelSchema.optional()
      })
      .default({ riskLevel: "medium" }),
    allowlist: z
      .object({
        addresses: z.array(z.string().min(1)).default([]),
        domains: z.array(z.string().min(1)).default([]),
        urls: z.array(z.string().min(1)).default([])
      })
      .default({ addresses: [], domains: [], urls: [] }),
    cache: z
      .object({
        ttlHours: z.number().positive().default(24)
      })
      .default({ ttlHours: 24 })
  })
  .default({
    enabled: false,
    apiKeyEnv: "WEBACY_API_KEY",
    chains: ["eth", "base", "sol"],
    failOn: { riskLevel: "high", sanctioned: true, maliciousUrl: true },
    warnOn: { riskLevel: "medium" },
    allowlist: { addresses: [], domains: [], urls: [] },
    cache: { ttlHours: 24 }
  });

const configSchema = z.object({
  councils: z.array(z.string().min(1)).default([]),
  providers: z.array(providerSchema).default([]),
  github: z
    .object({
      commentMode: z.enum(["update", "new", "off"]).optional(),
      failOn: z.union([severitySchema, z.literal("never")]).optional(),
      runnerMode: z.enum(["auto", "cli", "api"]).optional(),
      failOnDegraded: z.boolean().optional(),
      inlineComments: z.boolean().optional(),
      inlineCommentLimit: z.number().int().positive().optional(),
      gate: z
        .object({ severity: severitySchema, minAgreement: z.number().int().positive() })
        .optional()
    })
    .default({}),
  budget: z
    .object({
      maxFiles: z.number().int().positive().optional(),
      maxChangedLines: z.number().int().positive().optional(),
      maxCostUsd: z.number().nonnegative().optional(),
      skipGenerated: z.boolean().optional()
    })
    .optional(),
  merge: z.object({ provider: z.string().min(1) }).optional(),
  roleGuidance: z.record(z.string(), z.string()).optional(),
  integrations: z
    .object({
      webacy: webacySchema.optional()
    })
    .optional()
});

export function parseConfig(source: string): QuorateConfig {
  const parsed = YAML.parse(source) ?? {};
  const defaults = createDefaultConfig();
  const userConfig = configSchema.parse(parsed);

  return {
    councils: userConfig.councils.length > 0 ? userConfig.councils : defaults.councils,
    providers: userConfig.providers.length > 0 ? userConfig.providers : defaults.providers,
    github: {
      ...defaults.github,
      ...userConfig.github
    },
    budget: userConfig.budget,
    merge: userConfig.merge,
    roleGuidance: userConfig.roleGuidance,
    integrations: userConfig.integrations
  };
}

export function findConfigPath(cwd = process.cwd()): string | undefined {
  for (const filename of [".quorate.yml", ".quorate.yaml", "quorate.config.yml"]) {
    const candidate = resolve(cwd, filename);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function loadConfig(configPath?: string, cwd = process.cwd()): QuorateConfig {
  const resolvedPath = configPath ? resolve(cwd, configPath) : findConfigPath(cwd);
  if (!resolvedPath || !existsSync(resolvedPath)) {
    return createDefaultConfig();
  }

  return parseConfig(readFileSync(resolvedPath, "utf8"));
}

export function serializeConfig(config: QuorateConfig): string {
  const { customHeuristics: _customHeuristics, ...serializable } = config;
  return YAML.stringify(serializable, {
    lineWidth: 100
  });
}
