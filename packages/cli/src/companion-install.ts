import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * `quorate monitor install-companion [--from-local] [--release <tag>] [--dir <path>] [--force]`
 *
 * Installs the QuorateIsland native macOS app. Two paths:
 *
 * - **`--from-local`** (the working path today): build the app from the
 *   in-tree SwiftPM package at `native/QuorateIsland/` via `bundle.sh`, then
 *   move the resulting `.app` into `~/Applications`.
 *
 * - **default** (GitHub Release): download `QuorateIsland-<arch>.zip` + its
 *   `.sha256` from the latest (or `--release`) release, verify the checksum,
 *   unzip, and install the same way.
 *
 * macOS only. Everywhere else returns an honest message. Refuses to overwrite
 * an existing `~/Applications/QuorateIsland.app` unless `--force`.
 *
 * `fetch` and the unzip `exec` are injectable so tests run networkless.
 */

export interface CompanionInstallResult {
  ok: boolean;
  message: string;
  /** Absolute path of the installed app, when ok. */
  appPath?: string;
}

export interface CompanionInstallDeps {
  fetch?: (url: string) => Promise<Response | { ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }>;
  exec?: (cmd: string, args: string[], opts: Record<string, unknown>) => { status: number; stdout: string };
  platform?: NodeJS.Platform;
}

const REPO = "UmutKorkmaz/quorate";
const APP_NAME = "QuorateIsland.app";
const APP_BUNDLE_ID = "app.quorate.island";

function isMac(deps: CompanionInstallDeps): boolean {
  return (deps.platform ?? process.platform) === "darwin";
}

function archSuffix(): string {
  return process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : process.arch;
}

function applicationsDir(): string {
  return join(homedir(), "Applications");
}

function targetAppPath(dir?: string): string {
  return join(dir ?? applicationsDir(), APP_NAME);
}

/** Resolve which release asset matches the current arch. Pure. */
export function selectAsset(assets: Array<{ name: string; size?: number }>, arch: string = archSuffix()): { zip: string; sha: string } | undefined {
  const suffix = arch === "arm64" ? "arm64" : arch;
  const zip = assets.find((a) => a.name === `QuorateIsland-${suffix}.zip`);
  const sha = assets.find((a) => a.name === `QuorateIsland-${suffix}.zip.sha256`);
  if (!zip) return undefined;
  return { zip: zip.name, sha: sha?.name ?? `${zip.name}.sha256` };
}

/** Verify a downloaded buffer's sha256 against an expected hex digest. Pure. */
export function verifySha256(buffer: ArrayBuffer, expectedHex: string): boolean {
  const hash = createHash("sha256").update(Buffer.from(buffer)).digest("hex");
  // Constant-time-ish compare: both are fixed-length hex strings here.
  if (hash.length !== expectedHex.trim().length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i += 1) diff |= hash.charCodeAt(i) ^ expectedHex.trim().charCodeAt(i);
  return diff === 0;
}

/** Locate the built .app inside an unzipped bundle directory. */
export function findAppBundle(rootDir: string): string | undefined {
  try {
    for (const name of readdirSync(rootDir)) {
      const candidate = join(rootDir, name);
      if (name === APP_NAME && existsSync(join(candidate, "Contents", "Info.plist"))) return candidate;
    }
    // One level deep (typical unzip layout: root/<top-dir>/<app>).
    for (const name of readdirSync(rootDir)) {
      const sub = join(rootDir, name);
      try {
        for (const inner of readdirSync(sub)) {
          if (inner === APP_NAME) {
            const candidate = join(sub, inner);
            if (existsSync(join(candidate, "Contents", "Info.plist"))) return candidate;
          }
        }
      } catch {
        // Not a directory — skip.
      }
    }
  } catch {
    // Read error — caller surfaces a clear message.
  }
  return undefined;
}

/** Install `--from-local` path: build, then move the .app into place. */
export async function installFromLocal(
  repoRoot: string,
  options: { force?: boolean; dir?: string; exec?: CompanionInstallDeps["exec"] } = {}
): Promise<CompanionInstallResult> {
  const bundleDir = join(repoRoot, "native", "QuorateIsland");
  if (!existsSync(bundleDir)) {
    return { ok: false, message: `No native app source at ${bundleDir}. Run from the quorate repo, or use the default release path.` };
  }
  const exec = options.exec ?? ((cmd: string, args: string[], opts: Record<string, unknown>) => spawnSync(cmd, args, { ...opts, encoding: "utf8", shell: false }));
  // Build via bundle.sh.
  const build = exec("bash", [join(bundleDir, "scripts", "bundle.sh")], { cwd: bundleDir });
  if (build.status !== 0) {
    return { ok: false, message: `bundle.sh failed (exit ${build.status}).` };
  }
  const built = join(bundleDir, "dist", APP_NAME);
  if (!existsSync(built)) {
    return { ok: false, message: `bundle.sh did not produce ${built}.` };
  }
  return installApp(built, options);
}

/** Move a built .app into the target dir (refuse overwrite unless --force). */
export function installApp(
  builtAppPath: string,
  options: { force?: boolean; dir?: string } = {}
): CompanionInstallResult {
  const target = targetAppPath(options.dir);
  if (existsSync(target) && !options.force) {
    return { ok: false, message: `Refusing to overwrite ${target}. Pass --force to replace.` };
  }
  try {
    const installDir = options.dir ?? applicationsDir();
    if (!existsSync(installDir)) {
      mkdirSync(installDir, { recursive: true });
    }
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    renameSync(builtAppPath, target);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Could not install app: ${detail}` };
  }
  return {
    ok: true,
    appPath: target,
    message: `Installed ${target}. First run: right-click → Open (Gatekeeper prompt for ad-hoc signing).`
  };
}

/** Default path: download + verify + unzip + install. */
export async function installFromRelease(
  options: { release?: string; force?: boolean; dir?: string; deps?: CompanionInstallDeps } = {}
): Promise<CompanionInstallResult> {
  const deps = options.deps ?? {};
  const fetch = deps.fetch ?? ((url: string) => fetchGlobal(url));
  const exec = deps.exec ?? ((cmd: string, args: string[], opts: Record<string, unknown>) => spawnSync(cmd, args, { ...opts, encoding: "utf8", shell: false }));
  const tag = options.release ?? "latest";
  const apiUrl = `https://api.github.com/repos/${REPO}/releases/${tag === "latest" ? "latest" : `tags/${tag}`}`;
  let release: { assets?: Array<{ name: string; browser_download_url: string }> };
  try {
    const response = await fetch(apiUrl);
    if (!("ok" in response) || !response.ok) {
      return { ok: false, message: `Could not fetch release ${tag} (HTTP ${response.status}). Build locally with --from-local.` };
    }
    release = JSON.parse(Buffer.from(await response.arrayBuffer()).toString("utf8"));
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Release fetch failed: ${detail}. Build locally with --from-local.` };
  }
  const assets = release.assets ?? [];
  const asset = selectAsset(assets);
  if (!asset) {
    return { ok: false, message: `Release ${tag} has no QuorateIsland-${archSuffix()}.zip asset. Build locally with --from-local.` };
  }
  // Download zip + sha256.
  const zipUrl = assets.find((a) => a.name === asset.zip)?.browser_download_url;
  const shaUrl = assets.find((a) => a.name === asset.sha)?.browser_download_url;
  if (!zipUrl) return { ok: false, message: `Asset ${asset.zip} missing download URL.` };
  try {
    const zipResp = await fetch(zipUrl);
    const shaResp = shaUrl ? await fetch(shaUrl) : undefined;
    if (!("ok" in zipResp) || !zipResp.ok) return { ok: false, message: `Failed to download ${asset.zip}.` };
    const zipBuffer = await zipResp.arrayBuffer();
    let expectedHex = "";
    if (shaResp && "ok" in shaResp && shaResp.ok) {
      expectedHex = Buffer.from(await shaResp.arrayBuffer()).toString("utf8").trim();
    }
    if (expectedHex && !verifySha256(zipBuffer, expectedHex)) {
      return { ok: false, message: `sha256 mismatch for ${asset.zip} — refusing to install.` };
    }
    // Unzip into a temp dir.
    const tmp = mkdtempSync(join(homedir(), ".quorate-companion-"));
    try {
      const unzip = exec("unzip", ["-q", "-o", "-d", tmp], { input: Buffer.from(zipBuffer) });
      // unzip reads from stdin with - ; if that's not supported, write the zip to a temp file first.
      if (unzip.status !== 0) {
        const zipPath = join(tmp, "app.zip");
        writeFileSync(zipPath, Buffer.from(zipBuffer));
        const retry = exec("unzip", ["-q", "-o", zipPath, "-d", tmp], {});
        if (retry.status !== 0) return { ok: false, message: `unzip failed (exit ${retry.status}).` };
      }
      const built = findAppBundle(tmp);
      if (!built) return { ok: false, message: "Unzipped bundle did not contain QuorateIsland.app." };
      return installApp(built, options);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Install failed: ${detail}` };
  }
}

/** Top-level dispatcher used by the CLI. */
export async function installCompanion(options: {
  fromLocal?: boolean;
  release?: string;
  dir?: string;
  force?: boolean;
  repoRoot?: string;
  deps?: CompanionInstallDeps;
}): Promise<CompanionInstallResult> {
  const deps = options.deps ?? {};
  if (!isMac(deps)) {
    return { ok: false, message: "QuorateIsland is macOS-only today." };
  }
  if (options.fromLocal) {
    return installFromLocal(options.repoRoot ?? process.cwd(), {
      force: options.force,
      dir: options.dir,
      exec: deps.exec
    });
  }
  return installFromRelease({
    release: options.release,
    force: options.force,
    dir: options.dir,
    deps
  });
}

// Indirection so tests can stub the global fetch via deps.fetch.
async function fetchGlobal(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(60_000) });
}

void APP_BUNDLE_ID;
