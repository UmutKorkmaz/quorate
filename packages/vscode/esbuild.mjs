import { build, context } from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  // VS Code provides the `vscode` module at runtime; never bundle it.
  external: ["vscode"],
  outfile: "dist/extension.js",
  sourcemap: !production,
  minify: production,
  logLevel: "info"
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("watching…");
} else {
  await build(options);
  console.log("built dist/extension.js");
}
