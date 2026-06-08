export const SITE_URL = "https://umutkorkmaz.github.io/quorate";
export const SITE_NAME = "Quorate";
export const SITE_TAGLINE = "Multi-agent code review from one CLI.";
export const SITE_DESCRIPTION =
  "Quorate runs your local AI CLIs as a review council for diffs and plans. It deduplicates findings, ranks risk, and returns one PR-ready verdict with file-and-line evidence. Use it locally, headless in CI, or as a GitHub Action.";
export const REPO_URL = "https://github.com/UmutKorkmaz/quorate";
export const NPM_URL = "https://www.npmjs.com/package/quorate";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og.png`;

export function canonicalUrl(path = "/"): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === "/") return `${SITE_URL}/`;
  return `${SITE_URL}${normalized}`;
}

export function pageTitle(title: string): string {
  return title === SITE_NAME ? SITE_NAME : `${title} · ${SITE_NAME}`;
}
