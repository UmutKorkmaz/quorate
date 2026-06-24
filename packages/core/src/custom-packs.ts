import YAML from "yaml";
import { z } from "zod";
import { PACKS, type QuoratePack } from "./packs.js";
import { severities } from "./types.js";
import type { CustomHeuristicRule, QuorateConfig, Severity } from "./types.js";

const ID_RE = /^[a-z][a-z0-9-]{1,48}$/;
const MAX_PATTERN_LENGTH = 500;

const customPackSchema = z.object({
  version: z.number().int().optional(),
  id: z.string().regex(ID_RE),
  description: z.string().min(1),
  councils: z.array(z.string().min(1)).default([]),
  roleGuidance: z.record(z.string(), z.string()).optional(),
  role_guidance: z.record(z.string(), z.string()).optional(),
  heuristics: z
    .array(
      z.object({
        title: z.string().min(1),
        severity: z.enum(severities),
        body: z.string().min(1),
        pattern: z.string().min(1).max(MAX_PATTERN_LENGTH),
        filePattern: z.string().max(MAX_PATTERN_LENGTH).optional(),
        file_pattern: z.string().max(MAX_PATTERN_LENGTH).optional(),
        flags: z.string().regex(/^[imsu]*$/).optional()
      })
    )
    .default([])
});

export interface CustomPackDefinition {
  pack: QuoratePack;
  heuristics: CustomHeuristicRule[];
}

function compileRegex(source: string, flags = ""): RegExp {
  const safeFlags = flags.replace(/[gy]/g, "");
  return new RegExp(source, safeFlags);
}

export function parseCustomPackYaml(source: string, label = "custom pack"): CustomPackDefinition {
  let parsedYaml: unknown;
  try {
    parsedYaml = YAML.parse(source) ?? {};
  } catch {
    throw new Error(`Invalid ${label}: not valid YAML.`);
  }

  const parsed = customPackSchema.safeParse(parsedYaml);
  if (!parsed.success) {
    throw new Error(`Invalid ${label}: ${parsed.error.issues[0]?.message ?? "schema mismatch"}.`);
  }
  const data = parsed.data;
  if (data.version !== undefined && data.version !== 1) {
    throw new Error(`Invalid ${label}: unsupported version ${data.version} (expected 1).`);
  }
  if (PACKS[data.id]) {
    throw new Error(`Invalid ${label}: custom pack id "${data.id}" collides with a built-in pack.`);
  }

  const roleGuidance = { ...(data.role_guidance ?? {}), ...(data.roleGuidance ?? {}) };
  const councils = data.councils.length > 0 ? data.councils : Object.keys(roleGuidance);
  if (councils.length === 0) {
    throw new Error(`Invalid ${label}: add at least one council or role guidance entry.`);
  }

  const heuristics = data.heuristics.map((rule, index) => {
    try {
      const textRe = compileRegex(rule.pattern, rule.flags);
      const filePattern = rule.filePattern ?? rule.file_pattern;
      const fileRe = filePattern ? compileRegex(filePattern) : null;
      return {
        packId: data.id,
        title: rule.title,
        severity: rule.severity as Severity,
        body: rule.body,
        fileRe,
        textRe
      };
    } catch (error: unknown) {
      throw new Error(
        `Invalid ${label}: heuristic ${index + 1} has an invalid regular expression (${error instanceof Error ? error.message : String(error)}).`
      );
    }
  });

  return {
    pack: {
      id: data.id,
      description: data.description,
      councils,
      roleGuidance
    },
    heuristics
  };
}

export function applyCustomPackDefinitions(
  config: QuorateConfig,
  definitions: CustomPackDefinition[]
): QuorateConfig {
  if (definitions.length === 0) return config;
  const councils = [...config.councils];
  const roleGuidance: Record<string, string> = { ...(config.roleGuidance ?? {}) };
  const customHeuristics = [...(config.customHeuristics ?? [])];

  for (const definition of definitions) {
    for (const council of definition.pack.councils) {
      if (!councils.includes(council)) councils.push(council);
    }
    for (const [role, guidance] of Object.entries(definition.pack.roleGuidance)) {
      if (!roleGuidance[role]) roleGuidance[role] = guidance;
    }
    customHeuristics.push(...definition.heuristics);
  }

  return { ...config, councils, roleGuidance, customHeuristics };
}

export function customPackScaffold(id: string): string {
  if (!ID_RE.test(id)) {
    throw new Error("Custom pack id must be lowercase kebab-case, e.g. node-backend.");
  }
  if (PACKS[id]) {
    throw new Error(`"${id}" is a built-in pack id; choose a different custom pack id.`);
  }
  return YAML.stringify(
    {
      version: 1,
      id,
      description: `${id} review pack`,
      councils: [`${id}-reviewer`, "maintainer"],
      role_guidance: {
        [`${id}-reviewer`]: "Review this change for domain-specific correctness, security, and operational risk."
      },
      heuristics: [
        {
          title: "Example unsafe helper",
          severity: "medium",
          file_pattern: "\\.(ts|js)$",
          pattern: "unsafeHelper\\(",
          body: "Replace this example rule with a concrete project-specific risk pattern."
        }
      ]
    },
    { lineWidth: 100 }
  );
}
