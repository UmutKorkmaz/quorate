import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import Sitemap from "vite-plugin-sitemap";
import { DOC_PATHS } from "./src/components/DocNav";

const BASE = "/quorate/";
const SEGMENT_COUNT = 1;

const SPA_REDIRECT_IN_INDEX = `<!-- quorate:github-pages-spa -->
<script>
(function(l){if(l.search[1]==='/'){var d=l.search.slice(1).split('&').map(function(s){return s.replace(/~and~/g,'&')}).join('?');window.history.replaceState(null,null,l.pathname.slice(0,-1)+d+l.hash)}}(window.location))
</script>`;

function githubPagesSpaFallback(): Plugin {
  return {
    name: "quorate-github-pages-spa",
    apply: "build",
    closeBundle() {
      const dist = join(process.cwd(), "dist");
      const indexPath = join(dist, "index.html");
      let indexHtml = readFileSync(indexPath, "utf8");

      indexHtml = indexHtml.replace('href="/sitemap.xml"', `href="${BASE}sitemap.xml"`);
      if (!indexHtml.includes("quorate:github-pages-spa")) {
        indexHtml = indexHtml.replace("</head>", `${SPA_REDIRECT_IN_INDEX}\n</head>`);
      }
      writeFileSync(indexPath, indexHtml);

      const fallbackHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Quorate</title>
  <script>
    var segmentCount = ${SEGMENT_COUNT};
    var l = window.location;
    l.replace(
      l.protocol + '//' + l.hostname + (l.port ? ':' + l.port : '') +
      l.pathname.split('/').slice(0, 1 + segmentCount).join('/') + '/?/' +
      l.pathname.slice(1).split('/').slice(segmentCount).join('/').replace(/&/g, '~and~') +
      (l.search ? '&' + l.search.slice(1).replace(/&/g, '~and~') : '') +
      l.hash
    );
  </script>
</head>
<body></body>
</html>
`;
      writeFileSync(join(dist, "__spa-fallback.html"), fallbackHtml);
    }
  };
}

export default defineConfig({
  base: BASE,
  plugins: [
    tailwindcss(),
    react(),
    Sitemap({
      hostname: "https://umutkorkmaz.github.io",
      dynamicRoutes: ["/quorate/", ...DOC_PATHS.map((path) => `/quorate${path}`)],
      exclude: ["/"],
      generateRobotsTxt: false
    }),
    githubPagesSpaFallback()
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});