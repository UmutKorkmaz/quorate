import type { ReactNode } from "react";
import { CodeBlock } from "../../components/CodeBlock";

import { InlineCode } from "../../components/InlineCode";
import commandsMd from "../../generated/commands.md?raw";

function parseMarkdownTable(markdown: string): { headers: string[]; rows: string[][] } {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));

  if (lines.length < 2) {
    return { headers: [], rows: [] };
  }

  const parseRow = (line: string): string[] =>
    line
      .slice(1, -1)
      .split(/(?<!\\)\|/) // split on unescaped pipes only
      .map((cell) => cell.trim().replace(/\\\|/g, "|")); // then unescape \| -> |

  return {
    headers: parseRow(lines[0]),
    rows: lines.slice(2).map(parseRow)
  };
}

function renderCommandCell(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <InlineCode key={index}>{part.slice(1, -1)}</InlineCode>;
    }
    return <span key={index}>{part}</span>;
  });
}

export default function Commands() {
  const { headers, rows } = parseMarkdownTable(commandsMd);

  return (
    <article className="docs-content">
      <h1>Slash commands</h1>
      <p className="lead">
        Slash commands are the fastest way to load code, choose agents, route council roles, run
        reviews, and export reports from the interactive shell.
      </p>
      <p>
        Type <InlineCode>/</InlineCode> to open the command palette. The table below is generated
        from the CLI <InlineCode>commandRegistry</InlineCode> at build time, so it stays aligned with
        the installed command surface. Bare text follows the current mode: in{" "}
        <InlineCode>review</InlineCode> it reviews the loaded diff with your text as the subject; in{" "}
        <InlineCode>plan</InlineCode> it evaluates the text as a plan.
      </p>

      <div className="command-table">
        <table>
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>
                    {cellIndex === 0 ? renderCommandCell(cell) : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Common workflows</h2>
      <p>
        These examples are interactive-shell sessions. Replace provider ids, role names, file paths,
        and PR numbers with the values from your repo&apos;s <InlineCode>/providers</InlineCode>,{" "}
        <InlineCode>/skills</InlineCode>, and <InlineCode>/route</InlineCode> output.
      </p>

      <h3>Review the current working tree</h3>
      <CodeBlock language="text">{`/providers
/use available
/git
/review Check this change for release blockers`}</CodeBlock>

      <h3>Load a GitHub pull request</h3>
      <CodeBlock language="text">{`/pr 123
/use available
/review Review PR #123 for correctness, tests, and security regressions`}</CodeBlock>

      <h3>Route a role to specific agents, then inspect their output</h3>
      <CodeBlock language="text">{`/route
/route security claude codex
/review Focus on auth, secrets, and data handling
/logs
/logs claude:security
/route reset security`}</CodeBlock>

      <h3>Review a saved diff file and export the report</h3>
      <CodeBlock language="text">{`/diff /tmp/changes.diff
/use heuristic
/review Validate this patch before sharing it
/markdown .quorate/review.md
/json .quorate/review.json`}</CodeBlock>

      <h3>Fix a finding — snapshotted and revertible</h3>
      <p>
        <InlineCode>/fix</InlineCode> lists fixable findings; the delegation itself runs in your
        real terminal so you watch the agent work (its own permission flow stays active):
      </p>
      <CodeBlock language="bash">{`quorate fix --list             # numbered findings from the last review
quorate fix --finding 1        # pick agent (claude/codex/agy) -> confirm -> hand over
quorate fix --revert           # undo the last fix (pre-fix state is pinned first)`}</CodeBlock>
      <p>
        Revert restores tracked files, deletes agent-created files, and re-applies your own
        pre-fix uncommitted work — refusing when the tree changed since the fix
        (<InlineCode>--force</InlineCode> to override). After each fix, Quorate offers a council
        re-review.
      </p>

      <h3>Pick models from the live list</h3>
      <CodeBlock language="bash">{`quorate provider models openrouter      # list an endpoint's models (GET {baseUrl}/models)
quorate provider add local --preset ollama   # interactive model picker on a TTY
quorate provider set-model local             # switch an existing provider's model`}</CodeBlock>
      <p>
        In the shell, <InlineCode>/models &lt;provider&gt;</InlineCode> lists the live models and{" "}
        <InlineCode>/models &lt;provider&gt; &lt;model&gt;</InlineCode> switches it for the session.
      </p>
    </article>
  );
}
