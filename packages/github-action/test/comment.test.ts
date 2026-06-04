import { describe, expect, it } from "vitest";
import { reportCommentMarker } from "@quorate/core";
import { upsertReportComment } from "../src/comment.js";

describe("upsertReportComment", () => {
  it("updates an existing Quorate bot comment", async () => {
    const calls: string[] = [];
    const client = {
      rest: {
        issues: {
          listComments: {},
          createComment: async () => {
            calls.push("create");
          },
          updateComment: async () => {
            calls.push("update");
          }
        }
      },
      paginate: async () => [
        {
          id: 12,
          body: `${reportCommentMarker}\nold`,
          user: { type: "Bot" }
        }
      ]
    };

    const result = await upsertReportComment(client, {
      owner: "owner",
      repo: "repo",
      issueNumber: 2,
      body: `${reportCommentMarker}\nnew`,
      mode: "update"
    });

    expect(result).toBe("updated");
    expect(calls).toEqual(["update"]);
  });

  it("updates an existing comment authored by a PAT user (type User)", async () => {
    const calls: string[] = [];
    const client = {
      rest: {
        issues: {
          listComments: {},
          createComment: async () => {
            calls.push("create");
          },
          updateComment: async () => {
            calls.push("update");
          }
        }
      },
      paginate: async () => [
        {
          id: 99,
          body: `${reportCommentMarker}\nold`,
          user: { type: "User" }
        }
      ]
    };

    const result = await upsertReportComment(client, {
      owner: "owner",
      repo: "repo",
      issueNumber: 2,
      body: `${reportCommentMarker}\nnew`,
      mode: "update"
    });

    expect(result).toBe("updated");
    expect(calls).toEqual(["update"]);
  });

  it("creates a new comment when no marker exists", async () => {
    const calls: string[] = [];
    const client = {
      rest: {
        issues: {
          listComments: {},
          createComment: async () => {
            calls.push("create");
          },
          updateComment: async () => {
            calls.push("update");
          }
        }
      },
      paginate: async () => []
    };

    const result = await upsertReportComment(client, {
      owner: "owner",
      repo: "repo",
      issueNumber: 2,
      body: `${reportCommentMarker}\nnew`,
      mode: "update"
    });

    expect(result).toBe("created");
    expect(calls).toEqual(["create"]);
  });
});
