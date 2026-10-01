import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";

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
    js: `import { createRequire as quorateCreateRequire } from "node:module"; import { fileURLToPath as quorateFileURLToPath } from "node:url"; import { dirname as quorateDirname } from "node:path"; const __filename = quorateFileURLToPath(import.meta.url); const __dirname = quorateDirname(__filename); const require = quorateCreateRequire(import.meta.url);`
  }
});

execFileSync(process.execPath, ["--check", "dist/server.js"], { stdio: "inherit" });
console.log("Build complete → dist/server.js (syntax checked)");
