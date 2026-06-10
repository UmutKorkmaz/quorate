import { spawn } from "node:child_process";
import type { Finding, ProviderConfig, Severity } from "./types.js";

/**
 * Master-agent merge: one selected provider receives EVERY raw finding from the
 * council and returns a deduplicated partition — semantic dedup that lexical
 * clustering can't do ("console logging added" vs "remove stray debug logging").
 * The master may only merge; it must not invent, drop, or rewrite severities up.
 * Any failure (bad JSON, missing indices, timeout) falls back to the built-in
 * clustering — the council never loses findings to a flaky merge.
 */

const MERGE_TIMEOUT_MS = 120_000;
const DEFAULT_BASE_URL = "http://localhost:11434/v1";

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0
};

export function buildMergePrompt(findings: Finding[]): string {
  const list = findings.map((finding, index) => ({
    index,
    provider: finding.providerId,
    role: finding.role,
    severity: finding.severity,
    file: finding.file,
    line: finding.line,
    title: finding.title,
    body: finding.body,
    suggestion: finding.suggestion
  }));
  return [
    "You are the merge arbiter for a council of AI code reviewers.",
    "Several reviewers reported findings; many describe the SAME underlying issue in different words.",
    "Merge duplicates into one canonical finding each. Do NOT invent new findings, do NOT drop real distinct issues.",
    "",
    "Rules:",
    "- Output a JSON array. Each item: {\"sources\": [<input indexes>], \"title\": string, \"body\": string, \"severity\"?: one of critical|high|medium|low|info, \"file\"?: string, \"line\"?: number, \"suggestion\"?: string}.",
    "- Every input index MUST appear in exactly one item's sources (a partition).",
    "- Two findings are the same issue only if they refer to the same defect — same root cause at the same place.",
    "- Write the merged title/body as the clearest single statement of the issue (you may rephrase).",
    "- If unsure whether two findings are the same issue, keep them separate.",
    "- Output ONLY the JSON array (a ```json fence is fine). No prose.",
    "",
    "FINDINGS:",
    JSON.stringify(list, null, 1)
  ].join("\n");
}

interface MergeItem {
  sources: number[];
  title?: string;
  body?: string;
  severity?: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

function extractJsonArray(text: string): unknown {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((match) => match[1]);
  const candidates = [...fenced.reverse(), text];
  for (const candidate of candidates) {
    const start = candidate.indexOf("[");
    const end = candidate.lastIndexOf("]");
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      /* keep looking */
    }
  }
  return undefined;
}

/**
 * Validates the master's output against the inputs and builds merged findings.
 * Indexes the master ignored survive as untouched singletons; an index used
 * twice invalidates the whole merge (returns undefined → caller falls back).
 */
export function parseMergeResult(text: string, findings: Finding[]): Finding[] | undefined {
  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) return undefined;

  const used = new Set<number>();
  const merged: Finding[] = [];

  for (const raw of parsed as MergeItem[]) {
    if (typeof raw !== "object" || raw === null || !Array.isArray(raw.sources)) return undefined;
    const sources = raw.sources.filter(
      (index): index is number => Number.isInteger(index) && index >= 0 && index < findings.length
    );
    if (sources.length === 0) continue; // an item with no real sources is dropped, never invented
    for (const index of sources) {
      if (used.has(index)) return undefined; // double-use → the partition is broken
      used.add(index);
    }
    const members = sources.map((index) => findings[index]);
    const base = [...members].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])[0];
    const severity =
      typeof raw.severity === "string" && raw.severity in SEVERITY_RANK
        ? // The master may not LOWER the worst member's severity.
          (SEVERITY_RANK[raw.severity as Severity] >= SEVERITY_RANK[base.severity]
            ? (raw.severity as Severity)
            : base.severity)
        : base.severity;
    const agreedBy = [
      ...new Set(members.map((member) => member.providerId).filter((id): id is string => Boolean(id)))
    ].sort();

    merged.push({
      ...base,
      severity,
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : base.title,
      body: typeof raw.body === "string" && raw.body.trim() ? raw.body.trim() : base.body,
      file: typeof raw.file === "string" && raw.file ? raw.file : base.file,
      line: typeof raw.line === "number" ? raw.line : base.line,
      suggestion:
        typeof raw.suggestion === "string" && raw.suggestion
          ? raw.suggestion
          : (base.suggestion ?? members.find((member) => member.suggestion)?.suggestion),
      agreedBy,
      agreement: Math.max(agreedBy.length, 1)
    });
  }

  // Untouched inputs pass through unchanged — the master can't silently drop.
  for (const [index, finding] of findings.entries()) {
    if (!used.has(index)) merged.push(finding);
  }
  return merged;
}

async function callApi(provider: ProviderConfig, prompt: string, signal?: AbortSignal): Promise<string | undefined> {
  const url = `${(provider.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.apiKeyEnv) {
    const token = process.env[provider.apiKeyEnv];
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MERGE_TIMEOUT_MS);
  signal?.addEventListener("abort", () => controller.abort());
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0
      })
    });
    if (!response.ok) return undefined;
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function callCli(provider: ProviderConfig, prompt: string, signal?: AbortSignal): Promise<string | undefined> {
  // Only stdin-mode CLI providers can take an arbitrary prompt.
  if (provider.inputMode && provider.inputMode !== "stdin") return Promise.resolve(undefined);
  return new Promise((resolvePromise) => {
    const child = spawn(provider.command ?? provider.id, provider.args ?? [], { shell: false });
    let stdout = "";
    let done = false;
    const finish = (value: string | undefined): void => {
      if (done) return;
      done = true;
      resolvePromise(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(undefined);
    }, MERGE_TIMEOUT_MS);
    signal?.addEventListener("abort", () => {
      child.kill();
      finish(undefined);
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish(undefined);
    });
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0 ? stdout : undefined);
    });
    child.stdin.on("error", () => {
      /* EPIPE-safe */
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Runs the master merge. Returns the merged findings, or undefined when the
 * master can't run or returns an invalid partition (caller falls back to the
 * built-in clustering).
 */
export async function mergeWithMaster(
  provider: ProviderConfig,
  findings: Finding[],
  signal?: AbortSignal
): Promise<Finding[] | undefined> {
  if (findings.length < 2) return undefined;
  const prompt = buildMergePrompt(findings);
  const output =
    provider.type === "api"
      ? await callApi(provider, prompt, signal)
      : provider.type === "cli"
        ? await callCli(provider, prompt, signal)
        : undefined;
  if (!output) return undefined;
  return parseMergeResult(output, findings);
}
