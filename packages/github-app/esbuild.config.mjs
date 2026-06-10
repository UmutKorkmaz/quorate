import { build } from "esbuild";
import { rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });

await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/server.js",
  // Keep the public/ assets alongside the bundle at deploy time — the server
  // reads them from disk so they must NOT be embedded in the bundle.
  external: ["node:*"],
  banner: {
    // ESM bundle self-import shim — required for bundled __dirname equivalent
    js: `import { createRequire } from "node:module"; import { fileURLToPath } from "node:url"; import { dirname } from "node:path"; const __filename = fileURLToPath(import.meta.url); const __dirname = dirname(__filename); const require = createRequire(import.meta.url);`
  }
});

console.log("Build complete → dist/server.js");
