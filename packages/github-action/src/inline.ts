import { createHash } from "node:crypto";
import type { Finding } from "@quorate/core";

/** Existing review comment shape we care about (only the body is inspected). */
export interface ReviewComment {
  id?: number;
  body?: string;
}

/**
 * Minimal Octokit surface used to post and de-duplicate inline review comments.
 * Kept narrow so the logic can be exercised with plain stub objects in tests.
 */
export interface InlineCommentClient {
  paginate: <T>(endpoint: unknown, parameters: Record<string, unknown>) => Promise<T[]>;
  rest: {
    pulls: {
      listReviewComments: unknown;
      createReview: (parameters: never) => Promise<unknown>;
    };
  };
}

/**
 * Stable short hash identifying a finding by its location and content. Used in a
 * hidden HTML marker so re-runs can skip findings already posted as comments.
 */
export function findingMarkerHash(finding: Pick<Finding, "severity" | "file" | "line" | "title">): string {
  const key = `${finding.severity}|${finding.file ?? ""}|${finding.line ?? ""}|${finding.title}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 8);
}

/** The hidden marker embedded at the top of every inline comment body. */
export function findingMarker(hash: string): string {
  return `<!-- quorate-finding:${hash} -->`;
}

/** Render the visible body of an inline comment, prefixed with the hidden marker. */
function renderCommentBody(finding: Finding, hash: string): string {
  return `${findingMarker(hash)}\n**${finding.severity.toUpperCase()}: ${finding.title}**\n\n${finding.body}`;
}

/**
 * Post a single PR review whose comments pin located findings to their lines.
 *
 * Only findings that have BOTH a file and a line are eligible, capped at
 * `limit`. Existing review comments are fetched first; any finding whose marker
 * hash already appears in a comment body is skipped so re-runs do not duplicate.
 * Does nothing (and posts no review) when no findings qualify. Returns the count
 * of comments posted.
 */
export async function postInlineComments(
  client: InlineCommentClient,
  input: {
    owner: string;
    repo: string;
    pullNumber: number;
    commitId: string;
    findings: Finding[];
    limit: number;
  }
): Promise<number> {
  const located = input.findings.filter(
    (finding) => typeof finding.file === "string" && finding.file.length > 0 && typeof finding.line === "number"
  );
  if (located.length === 0) return 0;

  const existing = await client.paginate<ReviewComment>(client.rest.pulls.listReviewComments, {
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
    per_page: 100
  });
  const seen = new Set<string>();
  for (const comment of existing) {
    const match = comment.body?.match(/<!-- quorate-finding:([0-9a-f]+) -->/);
    if (match) seen.add(match[1]);
  }

  const comments: Array<{ path: string; line: number; side: "RIGHT"; body: string }> = [];
  for (const finding of located) {
    if (comments.length >= input.limit) break;
    const hash = findingMarkerHash(finding);
    if (seen.has(hash)) continue;
    seen.add(hash);
    comments.push({
      path: finding.file as string,
      line: finding.line as number,
      side: "RIGHT",
      body: renderCommentBody(finding, hash)
    });
  }

  if (comments.length === 0) return 0;

  await client.rest.pulls.createReview({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
    commit_id: input.commitId,
    event: "COMMENT",
    comments
  } as never);

  return comments.length;
}
