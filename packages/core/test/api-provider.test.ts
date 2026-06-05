import { afterEach, describe, expect, it, vi } from "vitest";
import { runApiProvider } from "../src/api-provider.js";
import type { CouncilRequest, ProviderConfig } from "../src/types.js";

const request: CouncilRequest = {
  mode: "review",
  subject: "fixture",
  diff: "diff --git a/file.ts b/file.ts\n+const x = 1;\n"
};

function apiProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "local-runner",
    type: "api",
    baseUrl: "http://localhost:11434/v1",
    model: "test-model",
    ...overrides
  };
}

function chatCompletion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runApiProvider", () => {
  it("parses findings from a chat-completions response and returns ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      chatCompletion("- [high] Title (file.ts:1): body")
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runApiProvider(apiProvider(), "maintainer", request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
    expect(result.providerType).toBe("api");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "high",
      title: "Title",
      file: "file.ts",
      line: 1,
      body: "body",
      providerId: "local-runner",
      role: "maintainer"
    });
  });

  it("POSTs to /chat/completions with the configured model and no auth header by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatCompletion("no findings here"));
    vi.stubGlobal("fetch", fetchMock);

    await runApiProvider(apiProvider(), "maintainer", request);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("test-model");
    expect(body.stream).toBe(false);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("adds a bearer token when apiKeyEnv is set and present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatCompletion("ok"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("MY_TOKEN", "secret-token");

    await runApiProvider(apiProvider({ apiKeyEnv: "MY_TOKEN" }), "maintainer", request);

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret-token");
  });

  it("returns error on a non-2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("upstream exploded", { status: 500, statusText: "Internal Server Error" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runApiProvider(apiProvider(), "maintainer", request);

    expect(result.status).toBe("error");
    expect(result.summary).toContain("500");
  });

  it("returns error without calling fetch when model is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runApiProvider(
      apiProvider({ model: undefined }),
      "maintainer",
      request
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
    expect(result.summary).toContain("model");
  });
});
