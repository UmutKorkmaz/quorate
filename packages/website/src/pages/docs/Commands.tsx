import type { ReactNode } from "react";
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
      .split("|")
      .map((cell) => cell.trim());

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
        Type <InlineCode>/</InlineCode> in the interactive shell to open the command palette.
        This table is generated from the CLI <InlineCode>commandRegistry</InlineCode> at build
        time. Bare text follows the current mode — in <InlineCode>review</InlineCode> it reviews
        the loaded diff with your text as the subject; in <InlineCode>plan</InlineCode> it
        evaluates the text as a plan.
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
    </article>
  );
}