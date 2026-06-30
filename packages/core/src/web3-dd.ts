import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  CouncilRequest,
  Finding,
  ProviderResult,
  QuorateConfig,
  WebacyIntegrationConfig,
  WebacyRiskLevel
} from "./types.js";
import { applyInlineSuppressions, type DiffLine } from "./heuristics.js";
import { redactSecrets } from "./redact.js";

const WEB3_DD_ROLE = "web3-due-diligence";
const PROVIDER_ID = "web3-dd";
const DEFAULT_CHAINS = ["eth", "base", "sol"];
const EVM_CHAINS = new Set(["eth", "base", "arb", "opt", "pol", "bsc", "sep"]);
const SUPPORTED_CHAINS = new Set([
  "eth",
  "base",
  "arb",
  "opt",
  "pol",
  "bsc",
  "sep",
  "sol",
  "sui",
  "stellar",
  "ton",
  "btc"
]);
const MAX_LIVE_INDICATORS = 25;
const MAX_CHAIN_QUERIES_PER_ADDRESS = 3;
const WEBACY_CONCURRENCY = 2;

const EVM_ADDRESS_RE = /\b0x[a-fA-F0-9]{40}\b/g;
const SOLANA_ADDRESS_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const URL_RE = /\bhttps?:\/\/[^\s"'`<>)\\]+/g;
const SOLANA_CONTEXT_RE =
  /\b(solana|anchor|spl|pubkey|publickey|address|mint|program|wallet|token|owner|authority|recipient|treasury|vault|escrow)\b/i;
const WEB3_URL_CONTEXT_RE =
  /\b(wallet|token|mint|contract|nft|swap|bridge|rpc|explorer|metadata|airdrop|claim|sign|transaction|program|web3)\b/i;
const APPROVAL_RE =
  /\b(approve\s*\(|setApprovalForAll\s*\(|MaxUint256|MAX_UINT|uint256\.max|2\s*\*\*\s*256\s*-\s*1|0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff)\b/i;
const TYPED_DATA_RE =
  /\b(signTypedData|eth_signTypedData|EIP712Domain|TypedDataEncoder|verifyingContract|typedData)\b/i;
const RAW_TRANSACTION_RE =
  /\b(sendRawTransaction|eth_sendRawTransaction|serializeTransaction|rawTransaction|VersionedTransaction\.deserialize)\b/i;
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i;

export type Web3IndicatorKind = "address" | "url";
export type Web3IndicatorChainType = "evm" | "solana" | "unknown";

export interface Web3Indicator {
  kind: Web3IndicatorKind;
  value: string;
  file?: string;
  line?: number;
  chainType: Web3IndicatorChainType;
  context: string;
}

export interface WebacyRiskClient {
  analyzeAddress(address: string, chain: string, signal?: AbortSignal): Promise<unknown>;
  checkSanctioned(address: string, chain: string, signal?: AbortSignal): Promise<unknown>;
  checkUrl(url: string, signal?: AbortSignal): Promise<unknown>;
}

interface RunWeb3DdOptions {
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  now?: number;
  cachePath?: string | false;
  client?: WebacyRiskClient;
}

interface CacheFile {
  entries: Record<string, { expiresAt: number; value: unknown }>;
}

interface RiskSummary {
  level: WebacyRiskLevel;
  score?: number;
  highCount?: number;
  mediumCount?: number;
  issues: string[];
  sanctioned?: boolean;
  maliciousUrl?: boolean;
}

function addedLines(diff: string): DiffLine[] {
  const result: DiffLine[] = [];
  let currentFile: string | undefined;
  let currentLine: number | undefined;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      currentFile = undefined;
      currentLine = undefined;
    } else if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length);
    } else if (line.startsWith("@@")) {
      const match = /\+(\d+)/.exec(line);
      currentLine = match ? Number(match[1]) : undefined;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      result.push({ file: currentFile, line: currentLine, text: line.slice(1) });
      if (currentLine !== undefined) currentLine += 1;
    } else if (!line.startsWith("-") && currentLine !== undefined) {
      currentLine += 1;
    }
  }

  return result;
}

function linesByFile(lines: DiffLine[]): Map<string, DiffLine[]> {
  const result = new Map<string, DiffLine[]>();
  for (const line of lines) {
    if (!line.file) continue;
    const bucket = result.get(line.file) ?? [];
    bucket.push(line);
    result.set(line.file, bucket);
  }
  return result;
}

function nearbyText(target: DiffLine, grouped: Map<string, DiffLine[]>, distance = 3): string {
  if (!target.file || target.line === undefined) return target.text;
  return (grouped.get(target.file) ?? [])
    .filter((line) => line.line !== undefined && Math.abs(line.line - target.line!) <= distance)
    .map((line) => line.text)
    .join("\n");
}

function normalizeUrl(raw: string): string | undefined {
  const trimmed = raw.replace(/[.,;:!?]+$/g, "");
  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
    if (LOCAL_HOST_RE.test(parsed.hostname) || parsed.hostname.endsWith(".local")) return undefined;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function normalizedChains(config?: WebacyIntegrationConfig): string[] {
  const raw = config?.chains?.length ? config.chains : DEFAULT_CHAINS;
  const chains = raw.map((chain) => chain.trim().toLowerCase()).filter((chain) => SUPPORTED_CHAINS.has(chain));
  return chains.length ? [...new Set(chains)] : DEFAULT_CHAINS;
}

function inferredChainFromContext(context: string): string | undefined {
  const lower = context.toLowerCase();
  if (/\b(base|8453)\b/.test(lower)) return "base";
  if (/\b(arbitrum|arb|42161)\b/.test(lower)) return "arb";
  if (/\b(optimism|opt|10)\b/.test(lower)) return "opt";
  if (/\b(polygon|matic|pol|137)\b/.test(lower)) return "pol";
  if (/\b(bsc|bnb|56)\b/.test(lower)) return "bsc";
  if (/\b(sepolia|sep|11155111)\b/.test(lower)) return "sep";
  if (/\b(ethereum|mainnet|eth|1)\b/.test(lower)) return "eth";
  if (/\b(solana|sol)\b/.test(lower)) return "sol";
  return undefined;
}

function chainsForIndicator(indicator: Web3Indicator, config?: WebacyIntegrationConfig): string[] {
  if (indicator.kind === "url") return [];
  const configured = normalizedChains(config);
  const inferred = inferredChainFromContext(`${indicator.context}\n${indicator.file ?? ""}`);
  if (indicator.chainType === "solana") return configured.includes("sol") ? ["sol"] : [];
  if (inferred && EVM_CHAINS.has(inferred) && configured.includes(inferred)) return [inferred];
  const evmChains = configured.filter((chain) => EVM_CHAINS.has(chain));
  return evmChains.slice(0, MAX_CHAIN_QUERIES_PER_ADDRESS);
}

function allowlistSets(config?: WebacyIntegrationConfig): {
  addresses: Set<string>;
  domains: Set<string>;
  urls: Set<string>;
} {
  return {
    addresses: new Set((config?.allowlist.addresses ?? []).map((value) => value.toLowerCase())),
    domains: new Set((config?.allowlist.domains ?? []).map((value) => value.toLowerCase())),
    urls: new Set((config?.allowlist.urls ?? []).map((value) => value.toLowerCase()))
  };
}

function isAllowlisted(indicator: Web3Indicator, config?: WebacyIntegrationConfig): boolean {
  const allow = allowlistSets(config);
  if (indicator.kind === "address") return allow.addresses.has(indicator.value.toLowerCase());
  const url = indicator.value.toLowerCase();
  const domain = hostnameOf(indicator.value);
  return allow.urls.has(url) || (domain ? allow.domains.has(domain) : false);
}

export function extractWeb3DdIndicators(diff: string, config?: WebacyIntegrationConfig): Web3Indicator[] {
  const lines = addedLines(diff);
  const grouped = linesByFile(lines);
  const seen = new Set<string>();
  const indicators: Web3Indicator[] = [];

  const add = (indicator: Web3Indicator): void => {
    if (isAllowlisted(indicator, config)) return;
    const key = `${indicator.kind}:${indicator.chainType}:${indicator.value.toLowerCase()}:${indicator.file ?? ""}:${indicator.line ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    indicators.push(indicator);
  };

  for (const line of lines) {
    const context = `${nearbyText(line, grouped)}\n${line.file ?? ""}`;

    for (const match of line.text.matchAll(EVM_ADDRESS_RE)) {
      add({
        kind: "address",
        value: match[0],
        file: line.file,
        line: line.line,
        chainType: "evm",
        context
      });
    }

    for (const match of line.text.matchAll(SOLANA_ADDRESS_RE)) {
      const value = match[0];
      if (/^0x/i.test(value)) continue;
      if (!SOLANA_CONTEXT_RE.test(context)) continue;
      add({
        kind: "address",
        value,
        file: line.file,
        line: line.line,
        chainType: "solana",
        context
      });
    }

    for (const match of line.text.matchAll(URL_RE)) {
      const value = normalizeUrl(match[0]);
      if (!value) continue;
      add({
        kind: "url",
        value,
        file: line.file,
        line: line.line,
        chainType: "unknown",
        context
      });
    }
  }

  return indicators;
}

function staticFindings(diff: string, config?: WebacyIntegrationConfig): Finding[] {
  const lines = addedLines(diff);
  const grouped = linesByFile(lines);
  const findings: Finding[] = [];
  const indicators = extractWeb3DdIndicators(diff, config);

  for (const line of lines) {
    const base = { file: line.file, line: line.line, providerId: PROVIDER_ID, role: WEB3_DD_ROLE };
    if (APPROVAL_RE.test(line.text)) {
      findings.push({
        ...base,
        severity: "medium",
        title: "High-risk token approval pattern",
        body:
          "This change introduces an approval-style token permission. Verify the spender is trusted, the allowance is bounded, and revocation is possible.",
        suggestion: "Prefer exact allowances, spender allowlists, and tests that prove approvals cannot be abused."
      });
    }
    if (TYPED_DATA_RE.test(line.text)) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Typed-data signing path changed",
        body:
          "EIP-712 / typed-data signing changes can alter what a wallet asks users to authorize. Verify the domain, chain id, verifying contract, and displayed fields.",
        suggestion: "Add fixtures for the exact typed-data payload users will sign."
      });
    }
    if (RAW_TRANSACTION_RE.test(line.text)) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Raw transaction submission path changed",
        body:
          "Raw transaction construction or submission bypasses some wallet/client safeguards. Verify simulation, chain id, recipient, value, and confirmation handling.",
        suggestion: "Simulate before submission and test that the transaction cannot be redirected to an unexpected recipient or chain."
      });
    }
  }

  for (const indicator of indicators) {
    if (indicator.kind === "address") {
      findings.push({
        providerId: PROVIDER_ID,
        role: WEB3_DD_ROLE,
        file: indicator.file,
        line: indicator.line,
        severity: "low",
        title: "Hardcoded Web3 address introduced",
        body:
          `${shortIndicator(indicator.value)} was added in a Web3-sensitive context. ` +
          "Confirm the address, chain, ownership, and upgrade path before merge.",
        suggestion: "Document the expected chain and owner, and allowlist known-safe addresses in Quorate if this is intentional."
      });
    } else if (WEB3_URL_CONTEXT_RE.test(indicator.context)) {
      findings.push({
        providerId: PROVIDER_ID,
        role: WEB3_DD_ROLE,
        file: indicator.file,
        line: indicator.line,
        severity: "low",
        title: "External Web3 URL introduced",
        body:
          `${hostnameOf(indicator.value) ?? indicator.value} was added in a wallet/token/transaction context. ` +
          "Verify it is not a phishing, malware, or untrusted metadata endpoint.",
        suggestion: "Prefer trusted domains and add tests or config allowlists for production endpoints."
      });
    }
  }

  return applyInlineSuppressions(findings, lines);
}

function shortIndicator(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function scoreToLevel(score: number | undefined): WebacyRiskLevel {
  if (score === undefined || Number.isNaN(score)) return "low";
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function maxLevel(left: WebacyRiskLevel, right: WebacyRiskLevel): WebacyRiskLevel {
  const rank: Record<WebacyRiskLevel, number> = { low: 1, medium: 2, high: 3 };
  return rank[right] > rank[left] ? right : left;
}

function meetsThreshold(level: WebacyRiskLevel, threshold?: WebacyRiskLevel): boolean {
  if (!threshold) return false;
  const rank: Record<WebacyRiskLevel, number> = { low: 1, medium: 2, high: 3 };
  return rank[level] >= rank[threshold];
}

function issueLabel(issue: unknown): string | undefined {
  if (!issue || typeof issue !== "object") return undefined;
  const record = issue as Record<string, unknown>;
  const candidates = [record.name, record.title, record.type, record.tag, record.category, record.description];
  const found = candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return found?.trim();
}

function normalizeAddressRisk(risk: unknown, sanctioned: unknown): RiskSummary {
  const record = risk && typeof risk === "object" ? (risk as Record<string, unknown>) : {};
  const score = typeof record.overallRisk === "number" ? record.overallRisk : undefined;
  const highCount = typeof record.high === "number" ? record.high : undefined;
  const mediumCount = typeof record.medium === "number" ? record.medium : undefined;
  let level = scoreToLevel(score);
  if ((highCount ?? 0) > 0) level = "high";
  else if ((mediumCount ?? 0) > 0) level = maxLevel(level, "medium");

  const issues = Array.isArray(record.issues)
    ? record.issues.map(issueLabel).filter((value): value is string => Boolean(value)).slice(0, 5)
    : [];
  const sanctionedRecord =
    sanctioned && typeof sanctioned === "object" ? (sanctioned as Record<string, unknown>) : {};
  const isSanctioned = sanctionedRecord.is_sanctioned === true || sanctionedRecord.isSanctioned === true;
  if (isSanctioned) {
    level = "high";
    issues.unshift("sanctioned address");
  }

  return {
    level,
    score,
    highCount,
    mediumCount,
    issues: [...new Set(issues)],
    sanctioned: isSanctioned
  };
}

function normalizeUrlRisk(risk: unknown): RiskSummary {
  const record = risk && typeof risk === "object" ? (risk as Record<string, unknown>) : {};
  const prediction = typeof record.prediction === "string" ? record.prediction.toLowerCase() : "";
  const blacklist = String(record.blacklist ?? "").toLowerCase();
  const details =
    record.details && typeof record.details === "object" ? (record.details as Record<string, unknown>) : {};
  const confidence = typeof details.confidence === "number" ? details.confidence : undefined;
  const maliciousUrl = prediction === "malicious" || blacklist === "true";
  const level = maliciousUrl ? "high" : scoreToLevel(confidence);
  const categories = Array.isArray(details.categories)
    ? details.categories.filter((value): value is string => typeof value === "string").slice(0, 5)
    : [];
  const threatType = typeof details.threat_type === "string" ? details.threat_type : undefined;

  return {
    level,
    score: confidence,
    issues: [...new Set([threatType, ...categories].filter((value): value is string => Boolean(value)))],
    maliciousUrl
  };
}

function severityForRisk(summary: RiskSummary, config: WebacyIntegrationConfig): "high" | "medium" | undefined {
  if (summary.sanctioned && config.failOn.sanctioned) return "high";
  if (summary.maliciousUrl && config.failOn.maliciousUrl) return "high";
  if (meetsThreshold(summary.level, config.failOn.riskLevel)) return "high";
  if (meetsThreshold(summary.level, config.warnOn.riskLevel)) return "medium";
  return undefined;
}

function riskBody(kind: Web3IndicatorKind, indicator: string, chain: string | undefined, summary: RiskSummary): string {
  const chainText = chain ? ` on ${chain}` : "";
  const scoreText = summary.score === undefined ? "" : ` Webacy score: ${summary.score}.`;
  const issueText = summary.issues.length ? ` Issues: ${summary.issues.join(", ")}.` : "";
  return `Webacy classified ${kind === "address" ? shortIndicator(indicator) : indicator}${chainText} as ${summary.level} risk.${scoreText}${issueText}`;
}

function findingFromRisk(
  indicator: Web3Indicator,
  chain: string | undefined,
  summary: RiskSummary,
  config: WebacyIntegrationConfig
): Finding | undefined {
  const severity = severityForRisk(summary, config);
  if (!severity) return undefined;
  const kindTitle = indicator.kind === "address" ? "address" : "URL";
  return {
    severity,
    title: `Webacy ${summary.level}-risk ${kindTitle} introduced`,
    body: riskBody(indicator.kind, indicator.value, chain, summary),
    file: indicator.file,
    line: indicator.line,
    providerId: PROVIDER_ID,
    role: WEB3_DD_ROLE,
    suggestion:
      indicator.kind === "address"
        ? "Verify the address owner, chain, token/contract behavior, and whether it belongs in an explicit allowlist before merge."
        : "Remove or replace the URL, or allowlist it only after independently verifying ownership and safety."
  };
}

async function createSdkClient(apiKey: string): Promise<WebacyRiskClient> {
  const { ThreatClient } = await import("@webacy-xyz/sdk-threat");
  const client = new ThreatClient({
    apiKey,
    timeout: 30_000,
    retry: { maxRetries: 2, initialDelay: 500, maxDelay: 5_000 }
  });
  return {
    analyzeAddress: (address, chain, signal) =>
      client.addresses.analyze(address, { chain: chain as never, detailed: true, deployerRisk: true, signal }),
    checkSanctioned: (address, chain, signal) =>
      client.addresses.checkSanctioned(address, { chain: chain as never, signal }),
    checkUrl: (url, signal) => client.url.check(url, { signal })
  };
}

async function readCacheFile(path: string | false | undefined): Promise<CacheFile> {
  if (!path) return { entries: {} };
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as CacheFile;
    return { entries: parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {} };
  } catch {
    return { entries: {} };
  }
}

async function writeCacheFile(path: string | false | undefined, cache: CacheFile): Promise<void> {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function cacheKey(kind: string, value: string, chain?: string): string {
  return `${kind}:${chain ?? "-"}:${value.toLowerCase()}`;
}

async function cached<T>(
  cache: CacheFile,
  key: string,
  ttlMs: number,
  now: number,
  fetcher: () => Promise<T>
): Promise<{ value: T; hit: boolean }> {
  const existing = cache.entries[key];
  if (existing && existing.expiresAt > now) {
    return { value: existing.value as T, hit: true };
  }
  const value = await fetcher();
  cache.entries[key] = { value, expiresAt: now + ttlMs };
  return { value, hit: false };
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: "fulfilled", value: await mapper(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function sanitizedError(error: unknown, apiKey?: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactSecrets(raw, [apiKey]) ?? "Webacy lookup failed.";
}

function webacyConfig(config: QuorateConfig): WebacyIntegrationConfig | undefined {
  return config.integrations?.webacy;
}

export function hasWeb3DdPack(config: QuorateConfig): boolean {
  return config.councils.some((council) =>
    ["web3-due-diligence", "wallet-safety", "phishing-safety"].includes(council)
  );
}

export function web3DdReviewEnabled(config: QuorateConfig, request: CouncilRequest): boolean {
  return request.mode === "review" && (hasWeb3DdPack(config) || webacyConfig(config)?.enabled === true);
}

export async function runWeb3DdReview(
  request: CouncilRequest,
  config: QuorateConfig,
  options: RunWeb3DdOptions = {}
): Promise<ProviderResult | undefined> {
  if (!web3DdReviewEnabled(config, request)) return undefined;

  const startedAt = Date.now();
  const diff = request.diff ?? "";
  const integration = webacyConfig(config);
  const staticIssues = staticFindings(diff, integration);

  if (!integration?.enabled) {
    return {
      providerId: PROVIDER_ID,
      role: WEB3_DD_ROLE,
      providerType: "mock",
      status: "ok",
      summary: `Web3 DD static scan produced ${staticIssues.length} finding${staticIssues.length === 1 ? "" : "s"}.`,
      findings: staticIssues,
      durationMs: Date.now() - startedAt
    };
  }

  const env = options.env ?? process.env;
  const apiKey = env[integration.apiKeyEnv];
  if (!apiKey) {
    return {
      providerId: PROVIDER_ID,
      role: WEB3_DD_ROLE,
      providerType: "api",
      status: "error",
      summary: `Webacy integration is enabled but ${integration.apiKeyEnv} is not set.`,
      findings: [
        ...staticIssues,
        {
          providerId: PROVIDER_ID,
          role: WEB3_DD_ROLE,
          severity: "high",
          title: "Webacy API key missing",
          body: `integrations.webacy.enabled is true, but ${integration.apiKeyEnv} is not available in the environment.`,
          suggestion: `Add ${integration.apiKeyEnv} as a CI secret or disable integrations.webacy.enabled.`
        }
      ],
      durationMs: Date.now() - startedAt,
      error: `${integration.apiKeyEnv} is missing`
    };
  }

  const indicators = extractWeb3DdIndicators(diff, integration).slice(0, MAX_LIVE_INDICATORS);
  if (indicators.length === 0) {
    return {
      providerId: PROVIDER_ID,
      role: WEB3_DD_ROLE,
      providerType: "api",
      status: "ok",
      summary: `Webacy integration found no address or URL indicators to query. Static scan produced ${staticIssues.length} finding${staticIssues.length === 1 ? "" : "s"}.`,
      findings: staticIssues,
      durationMs: Date.now() - startedAt
    };
  }

  const now = options.now ?? Date.now();
  const ttlMs = Math.max(0, integration.cache.ttlHours) * 60 * 60 * 1000;
  const cachePath =
    options.cachePath === false
      ? false
      : options.cachePath ?? resolve(request.repoPath ?? process.cwd(), ".quorate", "cache", "webacy.json");
  const cache = await readCacheFile(ttlMs > 0 ? cachePath : false);
  const client = options.client ?? (await createSdkClient(apiKey));
  let cacheHits = 0;

  type Query =
    | { type: "address"; indicator: Web3Indicator; chain: string }
    | { type: "url"; indicator: Web3Indicator };
  const queries: Query[] = [];
  for (const indicator of indicators) {
    if (indicator.kind === "address") {
      for (const chain of chainsForIndicator(indicator, integration)) {
        queries.push({ type: "address", indicator, chain });
      }
    } else {
      queries.push({ type: "url", indicator });
    }
  }

  const findings: Finding[] = [...staticIssues];
  const settled = await mapLimited(queries, WEBACY_CONCURRENCY, async (query) => {
    if (query.type === "url") {
      const key = cacheKey("url", query.indicator.value);
      const { value, hit } = await cached(cache, key, ttlMs, now, () =>
        client.checkUrl(query.indicator.value, options.signal)
      );
      if (hit) cacheHits += 1;
      const summary = normalizeUrlRisk(value);
      return findingFromRisk(query.indicator, undefined, summary, integration);
    }

    const addressKey = cacheKey("address", query.indicator.value, query.chain);
    const sanctionedKey = cacheKey("sanctioned", query.indicator.value, query.chain);
    const [{ value: risk, hit: riskHit }, { value: sanctioned, hit: sanctionedHit }] =
      await Promise.all([
        cached(cache, addressKey, ttlMs, now, () =>
          client.analyzeAddress(query.indicator.value, query.chain, options.signal)
        ),
        cached(cache, sanctionedKey, ttlMs, now, () =>
          client.checkSanctioned(query.indicator.value, query.chain, options.signal)
        )
      ]);
    if (riskHit) cacheHits += 1;
    if (sanctionedHit) cacheHits += 1;
    const summary = normalizeAddressRisk(risk, sanctioned);
    return findingFromRisk(query.indicator, query.chain, summary, integration);
  });

  let errorCount = 0;
  const errors: string[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      if (outcome.value) findings.push(outcome.value);
    } else {
      errorCount += 1;
      errors.push(sanitizedError(outcome.reason, apiKey));
    }
  }

  if (errorCount > 0) {
    findings.push({
      providerId: PROVIDER_ID,
      role: WEB3_DD_ROLE,
      severity: "high",
      title: "Webacy lookup failed",
      body:
        `${errorCount} of ${settled.length} Webacy lookup${settled.length === 1 ? "" : "s"} failed while integrations.webacy.enabled is true. ` +
        "Treat this as an incomplete due-diligence gate until the lookup succeeds.",
      suggestion: "Check WEBACY_API_KEY, Webacy rate limits, and network reachability, then rerun Quorate."
    });
  }

  if (ttlMs > 0) {
    await writeCacheFile(cachePath, cache);
  }

  const status = errorCount > 0 && errorCount === settled.length ? "error" : "ok";
  const errorSummary =
    errorCount > 0 ? ` ${errorCount} Webacy lookup${errorCount === 1 ? "" : "s"} failed.` : "";
  const hitSummary = cacheHits > 0 ? ` ${cacheHits} cache hit${cacheHits === 1 ? "" : "s"}.` : "";

  return {
    providerId: PROVIDER_ID,
    role: WEB3_DD_ROLE,
    providerType: "api",
    status,
    summary:
      `Web3 DD scanned ${indicators.length} indicator${indicators.length === 1 ? "" : "s"} and produced ` +
      `${findings.length} finding${findings.length === 1 ? "" : "s"}.${hitSummary}${errorSummary}`,
    findings: applyInlineSuppressions(findings, addedLines(diff)),
    durationMs: Date.now() - startedAt,
    error: errors[0]
  };
}
