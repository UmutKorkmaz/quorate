export interface PullRequestFile {
  filename: string;
  status?: string;
  patch?: string;
}

export interface PullRequestDiffClient {
  paginate: <T>(endpoint: unknown, parameters: Record<string, unknown>) => Promise<T[]>;
  rest: {
    pulls: {
      listFiles: unknown;
    };
  };
}

export async function buildPullRequestDiff(
  client: PullRequestDiffClient,
  input: { owner: string; repo: string; pullNumber: number }
): Promise<string> {
  const files = await client.paginate<PullRequestFile>(client.rest.pulls.listFiles, {
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
    per_page: 100
  });

  return files
    .map((file) => {
      const header = `diff --git a/${file.filename} b/${file.filename}\n--- a/${file.filename}\n+++ b/${file.filename}`;
      return file.patch ? `${header}\n${file.patch}` : `${header}\n# ${file.status ?? "changed"} file has no textual patch`;
    })
    .join("\n");
}
