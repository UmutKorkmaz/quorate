import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { serverListenOptions as options } from "../src/server.js";

it("preserves the default listener and validates explicit addresses before startup", () => {
  expect(options({})).toEqual({ port: 3000 });
  expect(options({ HOST: " 127.0.0.1 ", PORT: "3296" })).toEqual({ port: 3296, host: "127.0.0.1" });
  expect(options({ HOST: "::1" })).toEqual({ port: 3000, host: "::1" });
  for (const env of [{ HOST: "https://example.invalid" }, { HOST: "0.0.0.0;echo invalid" }, { PORT: "NaN" }, { PORT: "0" }, { PORT: "65536" }, { PORT: "1.5" }]) {
    expect(() => options(env)).toThrow();
  }
});

it("binds a real HTTP listener to the selected loopback address", async () => {
  const listener = createServer((_request, response) => response.end("loopback"));
  const selected = options({ HOST: "127.0.0.1", PORT: "3296" });
  expect(selected).toBeDefined();
  // An ephemeral port prevents collisions while exercising the selected host.
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen({ ...selected, port: 0 }, resolve);
  });
  try {
    const address = listener.address() as AddressInfo;
    expect(address.address).toBe("127.0.0.1");
    expect(await (await fetch(`http://127.0.0.1:${address.port}`)).text()).toBe("loopback");
  } finally {
    await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  }
});
