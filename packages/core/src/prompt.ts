/** Shared reviewer prompt builder — single source for api and cli providers. */
import type { CouncilRequest, ProviderConfig } from "./types.js";

export function buildReviewPrompt(
  provider: ProviderConfig,
  role: string,
  request: CouncilRequest
): string {
  const header = [
    `You are the ${role} member of Quorate.`,
    `Mode: ${request.mode}`,
    `Subject: ${request.subject}`,
    "Return concise findings as Markdown bullets. Use this finding format when possible:",
    "- [severity] Title (path/to/file.ts:12): concrete evidence and recommendation",
    "Use severity values: critical, high, medium, low, info.",
    "You MAY instead return a JSON array of findings in a fenced ```json block, where each item is",
    '{"severity","title","body","file?","line?","suggestion?"}.'
  ].join("\n");

  const guidance = request.roleGuidance?.[role];
  const guidanceBlock =
    guidance && guidance.length > 0
      ? `\n\nReviewer guidance for ${role}:\n${guidance}`
      : "";

  const diffSection = request.diff ? `\n\nDiff:\n${request.diff}` : "";
  return `${header}${guidanceBlock}\n\nProvider: ${provider.id}${diffSection}`;
}
