import type { Finding } from "@quorate/core";

/** ± lines of diff context handed to the fixing agent. */
const HUNK_CONTEXT = 20;

/** Extract the diff hunk around `file:line` from a unified diff, if present. */
export function extractHunk(diff: string | undefined, file?: string, line?: number, context = HUNK_CONTEXT): string {
  if (!diff || !file) return "";
  const lines = diff.split("\n");
  const startOfFile = lines.findIndex(
    (l) => l.startsWith("diff --git") && (l.includes(` a/${file}`) || l.includes(` b/${file}`))
  );
  if (startOfFile < 0) return "";
  let endOfFile = lines.length;
  for (let i = startOfFile + 1; i < lines.length; i++) {
    if (lines[i].startsWith("diff --git")) {
      endOfFile = i;
      break;
    }
  }
  const fileLines = lines.slice(startOfFile, endOfFile);
  if (!line) return fileLines.slice(0, context * 2).join("\n");

  // Find the hunk whose new-file range covers `line`.
  for (let i = 0; i < fileLines.length; i++) {
    const match = fileLines[i].match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!match) continue;
    const start = Number(match[1]);
    const count = Number(match[2] ?? 1);
    if (line >= start && line < start + count) {
      const slice = fileLines.slice(Math.max(0, i - 1), i + context * 2);
      return slice.join("\n");
    }
  }
  return fileLines.slice(0, context * 2).join("\n");
}

/** The prompt handed to the fixing agent: scoped, surgical, no commits. */
export function buildFixPrompt(finding: Finding, diffHunk = ""): string {
  const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}` : "(no file recorded)";
  const sections = [
    "You are fixing one code-review finding identified by a council of AI reviewers.",
    "",
    "FINDING",
    `  severity: ${finding.severity}`,
    `  location: ${location}`,
    `  title: ${finding.title}`,
    "",
    "DETAILS",
    finding.body || finding.title
  ];
  if (finding.suggestion) {
    sections.push("", "SUGGESTED FIX", finding.suggestion);
  }
  if (diffHunk) {
    sections.push("", "CONTEXT (diff hunk around the finding)", "```diff", diffHunk, "```");
  }
  sections.push(
    "",
    "INSTRUCTIONS",
    "- Change only what is needed to address this finding.",
    "- Do not refactor unrelated code or add explanatory comments.",
    "- Preserve the existing code style (indentation, naming, imports)."
  );
  if (finding.line) sections.push(`- The finding points at line ${finding.line}; focus your edit there.`);
  sections.push(
    "- If a test covers this code, keep it passing (update it only if required).",
    "- Do NOT commit. Make file edits only, then stop."
  );
  return sections.join("\n");
}
