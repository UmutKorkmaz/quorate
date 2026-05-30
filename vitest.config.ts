import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/*/test/**/*.test.{ts,tsx}"],
    coverage: {
      reporter: ["text", "html"]
    }
  },
  resolve: {
    alias: {
      "@quorate/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname
    }
  }
});
