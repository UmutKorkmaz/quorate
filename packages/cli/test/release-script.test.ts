import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const releaseScript = readFileSync(
  new URL("../../../scripts/release.sh", import.meta.url),
  "utf8"
);

describe("release helper", () => {
  it("publishes only the self-contained public CLI package", () => {
    expect(releaseScript).toContain(
      'run npm publish --workspace quorate "${PUBLISH_ARGS[@]}"'
    );
    expect(releaseScript).not.toMatch(
      /npm publish --workspace @quorate\/core/
    );
  });
});
