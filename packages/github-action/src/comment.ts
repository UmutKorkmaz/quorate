import { reportCommentMarker } from "@quorate/core";

export interface IssueComment {
  id: number;
  body?: string;
  user?: {
    type?: string;
  };
}

export interface CommentClient {
  paginate: <T>(endpoint: unknown, parameters: Record<string, unknown>) => Promise<T[]>;
  rest: {
    issues: {
      listComments: unknown;
      createComment: (parameters: never) => Promise<unknown>;
      updateComment: (parameters: never) => Promise<unknown>;
    };
  };
}

export async function upsertReportComment(
  client: CommentClient,
  input: {
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
    mode: "update" | "new";
  }
): Promise<"created" | "updated"> {
  if (input.mode === "new") {
    await client.rest.issues.createComment({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.issueNumber,
      body: input.body
    } as never);
    return "created";
  }

  const comments = await client.paginate<IssueComment>(client.rest.issues.listComments, {
    owner: input.owner,
    repo: input.repo,
    issue_number: input.issueNumber,
    per_page: 100
  });
  // Match by the marker alone so the comment is found even when it was authored
  // by a PAT user (type "User") rather than the GitHub Actions bot.
  const existing = comments.find((comment) => comment.body?.includes(reportCommentMarker));

  if (existing) {
    await client.rest.issues.updateComment({
      owner: input.owner,
      repo: input.repo,
      comment_id: existing.id,
      body: input.body
    } as never);
    return "updated";
  }

  await client.rest.issues.createComment({
    owner: input.owner,
    repo: input.repo,
    issue_number: input.issueNumber,
    body: input.body
  } as never);
  return "created";
}
