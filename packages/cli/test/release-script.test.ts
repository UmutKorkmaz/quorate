import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const releaseScript = readFileSync(
  new URL("../../../scripts/release.sh", import.meta.url),
  "utf8"
);

function checkRegistryVisibility(visibleAfter: number) {
  const directory = mkdtempSync(join(tmpdir(), "quorate-registry-test-"));
  const counter = join(directory, "reads");
  writeFileSync(counter, "0");
  try {
    const start = releaseScript.indexOf("# npm can accept a publish");
    const end = releaseScript.indexOf("PUBLISHED_CLI=", start);
    if (start < 0 || end < 0) throw new Error("Registry verification block missing");
    const result = spawnSync("bash", ["-c", `
      fail() { printf '%s\\n' "$*" >&2; exit 1; }
      sleep() { :; }
      npm() {
        local count="$(cat "$REGISTRY_READS")"
        count=$((count + 1))
        printf '%s' "$count" > "$REGISTRY_READS"
        [[ "$count" -ge "$VISIBLE_AFTER" ]] || return 1
        printf '%s' "$VERSION"
      }
      ${releaseScript.slice(start, end)}
    `], {
      encoding: "utf8",
      env: { ...process.env, VERSION: "1.4.0", REGISTRY_READS: counter, VISIBLE_AFTER: String(visibleAfter) },
    });
    return { ...result, reads: Number(readFileSync(counter, "utf8")) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("release helper", () => {
  it("publishes only the self-contained public CLI package", () => {
    expect(releaseScript).toContain(
      'run npm publish --workspace quorate "${PUBLISH_ARGS[@]}"'
    );
    expect(releaseScript).not.toMatch(
      /npm publish --workspace @quorate\/core/
    );
  });

  it.skipIf(process.platform === "win32")("waits for an accepted version to reach registry readers", () => {
    const result = checkRegistryVisibility(3);
    expect(result.status).toBe(0);
    expect(result.reads).toBe(3);
    expect(result.stdout).toContain("Waiting for registry visibility (2/30)");
  });

  it.skipIf(process.platform === "win32")("bounds retries and warns against republishing after a visibility timeout", () => {
    const result = checkRegistryVisibility(31);
    expect(result.status).toBe(1);
    expect(result.reads).toBe(30);
    expect(result.stderr).toContain("verify registry status before any further publish");
  });
});
