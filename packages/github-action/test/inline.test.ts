import { describe, expect, it } from "vitest";
import { findingMarker, findingMarkerHash, postInlineComments } from "../src/inline.js";

interface CreatedReview {
  pull_number: number;
  commit_id: string;
  event: string;
  comments: Array<{ path: string; line: number; side: string; body: string }>;
}

/**
 * Stub inline-comment client: records createReview calls and serves a fixed set
 * of pre-existing review comments from paginate.
 */
function makeClient(existing: Array<{ body?: string }> = []) {
  const reviews: CreatedReview[] = [];
  const client = {
    rest: {
      pulls: {
        listReviewComments: { id: "listReviewComments" },
        createReview: async (params: CreatedReview) => {
          reviews.push(params);
        }
      }
    },
    paginate: async () => existing
  };
  return { client, reviews };
}

const finding = (over: Partial<{ severity: string; title: string; body: string; file: string; line: number }> = {}) => ({
  severity: "high",
  title: "SQL injection",
  body: "User input flows into a query.",
  file: "src/db.ts",
  line: 42,
  ...over
});

describe("postInlineComments", () => {
  it("posts up to limit line comments for located findings", async () => {
    const { client, reviews } = makeClient();
    const findings = [
      finding({ title: "One", file: "a.ts", line: 1 }),
      finding({ title: "Two", file: "b.ts", line: 2 }),
      finding({ title: "Three", file: "c.ts", line: 3 })
    ];

    const posted = await postInlineComments(client as never, {
      owner: "owner",
      repo: "repo",
      pullNumber: 7,
      commitId: "head-sha",
      findings: findings as never,
      limit: 2
    });

    expect(posted).toBe(2);
    expect(reviews.length).toBe(1);
    expect(reviews[0].event).toBe("COMMENT");
    expect(reviews[0].commit_id).toBe("head-sha");
    expect(reviews[0].comments.length).toBe(2);
    expect(reviews[0].comments[0].path).toBe("a.ts");
    expect(reviews[0].comments[0].side).toBe("RIGHT");
    expect(reviews[0].comments[0].body).toContain(findingMarker(findingMarkerHash(findings[0] as never)));
    expect(reviews[0].comments[0].body).toContain("HIGH");
    expect(reviews[0].comments[0].body).toContain("One");
  });

  it("skips findings already present via marker hash match", async () => {
    const dup = finding({ title: "Already there", file: "x.ts", line: 9 });
    const hash = findingMarkerHash(dup as never);
    const { client, reviews } = makeClient([{ body: `${findingMarker(hash)}\nold comment` }]);

    const fresh = finding({ title: "New one", file: "y.ts", line: 10 });
    const posted = await postInlineComments(client as never, {
      owner: "owner",
      repo: "repo",
      pullNumber: 7,
      commitId: "head-sha",
      findings: [dup, fresh] as never,
      limit: 10
    });

    expect(posted).toBe(1);
    expect(reviews.length).toBe(1);
    expect(reviews[0].comments.length).toBe(1);
    expect(reviews[0].comments[0].path).toBe("y.ts");
  });

  it("does nothing when no located findings exist", async () => {
    const { client, reviews } = makeClient();
    const findings = [
      finding({ file: undefined, line: undefined }),
      finding({ file: "a.ts", line: undefined })
    ];

    const posted = await postInlineComments(client as never, {
      owner: "owner",
      repo: "repo",
      pullNumber: 7,
      commitId: "head-sha",
      findings: findings as never,
      limit: 10
    });

    expect(posted).toBe(0);
    expect(reviews.length).toBe(0);
  });

  it("posts no review when every located finding is a duplicate", async () => {
    const dup = finding({ title: "Dup", file: "z.ts", line: 5 });
    const hash = findingMarkerHash(dup as never);
    const { client, reviews } = makeClient([{ body: findingMarker(hash) }]);

    const posted = await postInlineComments(client as never, {
      owner: "owner",
      repo: "repo",
      pullNumber: 7,
      commitId: "head-sha",
      findings: [dup] as never,
      limit: 10
    });

    expect(posted).toBe(0);
    expect(reviews.length).toBe(0);
  });
});
