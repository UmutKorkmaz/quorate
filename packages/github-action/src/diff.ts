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

function patchHasCompleteHunks(patch: string): boolean {
  let sawHunk = false;
  let oldRemaining = 0;
  let newRemaining = 0;

  const complete = (): boolean => oldRemaining === 0 && newRemaining === 0;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("@@")) {
      if (sawHunk && !complete()) return false;
      const match = /-(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))?/.exec(line);
      if (!match) return false;
      oldRemaining = Number(match[2] ?? "1");
      newRemaining = Number(match[4] ?? "1");
      sawHunk = true;
      continue;
    }
    if (!sawHunk || line.startsWith("\\ No newline at end of file")) continue;
    if (line.startsWith("+")) newRemaining -= 1;
    else if (line.startsWith("-")) oldRemaining -= 1;
    else if (line.startsWith(" ")) {
      oldRemaining -= 1;
      newRemaining -= 1;
    }
    if (oldRemaining < 0 || newRemaining < 0) return false;
  }

  return sawHunk && complete();
}

export async function buildPullRequestDiff(
  client: PullRequestDiffClient,
  input: { owner: string; repo: string; pullNumber: number },
  maxBytes = 250_000
): Promise<string> {
  const files = await client.paginate<PullRequestFile>(client.rest.pulls.listFiles, {
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
    per_page: 100
  });

  const blocks: string[] = [];
  let size = 0;
  let shown = 0;

  for (const file of files) {
    const header = `diff --git a/${file.filename} b/${file.filename}\n--- a/${file.filename}\n+++ b/${file.filename}`;
    // status values like removed/renamed/binary have no textual patch; the
    // fallback line covers any file where `patch` is absent so we never crash.
    const block = file.patch
      ? `${header}\n${file.patch}${
          patchHasCompleteHunks(file.patch)
            ? ""
            : `\n# quorate-supply-chain-incomplete: patch hunk is truncated (${file.filename})`
        }`
      : `${header}\n# quorate-supply-chain-incomplete: ${file.status ?? "changed"} file has no textual patch`;

    const blockBytes = Buffer.byteLength(block, "utf8");
    const separatorBytes = blocks.length > 0 ? 1 : 0;
    if (size + separatorBytes + blockBytes > maxBytes) {
      if (shown === 0) {
        blocks.push(header);
        blocks.push(
          `# quorate-supply-chain-incomplete: first patch exceeds ${maxBytes} bytes (${file.filename})`
        );
      } else {
        blocks.push(
          `# quorate-supply-chain-incomplete: diff truncated to ${maxBytes} bytes (${shown} of ${files.length} files shown)`
        );
      }
      return blocks.join("\n");
    }

    blocks.push(block);
    size += separatorBytes + blockBytes;
    shown += 1;
  }

  return blocks.join("\n");
}
