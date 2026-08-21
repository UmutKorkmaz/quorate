import { afterEach, describe, expect, it, vi } from "vitest";
import { runApiProvider } from "../src/api-provider.js";
import { runCliProvider } from "../src/cli-provider.js";
import type { CouncilRequest, ProviderConfig } from "../src/types.js";

const request: CouncilRequest = {
  mode: "plan",
  subject: "redaction check"
};

function cliProvider(script: string): ProviderConfig {
  return {
    id: "node",
    type: "cli",
    command: "node",
    args: ["-e", script],
    inputMode: "none"
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider result redaction", () => {
  it("redacts secrets from rawOutput on ok runs", async () => {
    const result = await runCliProvider(
      cliProvider(
        "console.log('review complete'); console.error('api_key=sk-ant-api3-AAAAAAAAAAAAAAAAAAAAAAAA');"
      ),
      "maintainer",
      request
    );

    expect(result.status).toBe("ok");
    expect(result.rawOutput).toContain("review complete");
    expect(result.rawOutput).not.toContain("sk-ant-");
    expect(result.rawOutput).toContain("api_key=[redacted]");
  });

  it("redacts secrets from rawOutput and error on failed runs", async () => {
    const result = await runCliProvider(
      cliProvider("console.error('token Bearer abcdefghijklmnop'); process.exit(3);"),
      "maintainer",
      request
    );

    expect(result.status).toBe("error");
    expect(result.rawOutput).not.toContain("abcdefghijklmnop");
    expect(result.error).not.toContain("abcdefghijklmnop");
    expect(result.error).toContain("Bearer [redacted]");
  });

  it("redacts Bearer and sk-ant secrets from rawOutput, error, and summary", async () => {
    const failing = await runCliProvider(
      cliProvider(
        "console.error('Bearer abcdefghijklmnop'); console.error('sk-ant-api3-AAAAAAAAAAAAAAAAAAAAAAAA'); process.exit(2);"
      ),
      "maintainer",
      request
    );

    expect(failing.status).toBe("error");
    expect(failing.rawOutput).not.toContain("abcdefghijklmnop");
    expect(failing.rawOutput).not.toContain("sk-ant-api3");
    expect(failing.error).not.toContain("abcdefghijklmnop");
    expect(failing.error).not.toContain("sk-ant-api3");
    expect(failing.error).toContain("Bearer [redacted]");

    const ok = await runCliProvider(
      cliProvider("console.log('sk-ant-api3-AAAAAAAAAAAAAAAAAAAAAAAA reviewed diff');"),
      "maintainer",
      request
    );

    expect(ok.status).toBe("ok");
    expect(ok.summary).not.toContain("sk-ant-api3");
    expect(ok.summary).toContain("[redacted]");
    expect(ok.summary).toContain("reviewed diff");
  });

  it("redacts provider-configured env values from output", async () => {
    const result = await runCliProvider(
      {
        ...cliProvider("console.log('token ' + process.env.QUORATE_TEST_TOKEN);"),
        env: { QUORATE_TEST_TOKEN: "env-secret-value-123456" }
      },
      "maintainer",
      request
    );

    expect(result.status).toBe("ok");
    expect(result.rawOutput).not.toContain("env-secret-value-123456");
    expect(result.rawOutput).toContain("token [redacted]");
  });

  it("still parses findings from the redacted output", async () => {
    const result = await runCliProvider(
      cliProvider("console.log('- [high] Leak (auth.ts:9): uses token=sk-secret1234567890');"),
      "security",
      request
    );

    expect(result.status).toBe("ok");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ severity: "high", file: "auth.ts", line: 9 });
    expect(result.findings[0].body).not.toContain("sk-secret1234567890");
    expect(result.findings[0].body).toContain("token=[redacted]");
    expect(result.rawOutput).not.toContain("sk-secret1234567890");
    expect(result.rawOutput).toContain("token=[redacted]");
  });

  it("redacts secrets from rawOutput on ok API runs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "- [low] Ok (a.ts:1): fine\napi_key=sk-secret1234567890" } }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    const result = await runApiProvider(
      {
        id: "local-runner",
        type: "api",
        baseUrl: "http://localhost:11434/v1",
        model: "test-model"
      },
      "maintainer",
      request
    );

    expect(result.status).toBe("ok");
    expect(result.findings).toHaveLength(1);
    expect(result.rawOutput).not.toContain("sk-secret1234567890");
    expect(result.rawOutput).toContain("api_key=[redacted]");
  });
});
