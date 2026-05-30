import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["./.tsc/index.js"],
  outfile: "./dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: {
    js: "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);"
  },
  external: ["ink", "react", "react/jsx-runtime", "react/jsx-dev-runtime"]
});

chmodSync("./dist/index.js", 0o755);
