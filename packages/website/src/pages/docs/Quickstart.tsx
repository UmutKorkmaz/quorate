import { Link } from "react-router";
import { CodeBlock } from "../../components/CodeBlock";

import { InlineCode } from "../../components/InlineCode";

export default function Quickstart() {
  return (
    <article className="docs-content">
      <h1>Quick start</h1>
      <p className="lead">
        Open the shell, load a diff, enable detected agents, and run your first council review.
      </p>

      <ol className="doc-steps">
        <li>
          <strong>Open the shell</strong>
          <span>
            Run <InlineCode>quorate</InlineCode> with no arguments.
          </span>
        </li>
        <li>
          <strong>Load a diff</strong>
          <span>
            Run <InlineCode>/git</InlineCode> to load a git diff from the current repo.
          </span>
        </li>
        <li>
          <strong>Enable providers</strong>
          <span>
            Run <InlineCode>/use available</InlineCode> to enable every detected, runnable AI CLI
            for this session.
          </span>
        </li>
        <li>
          <strong>Review</strong>
          <span>
            Run <InlineCode>/review</InlineCode> to convene the council over the loaded diff.
          </span>
        </li>
      </ol>

      <CodeBlock language="bash">quorate</CodeBlock>
      <CodeBlock language="text">{`/git
/use available
/review`}</CodeBlock>

      <h2>One-shot CLI</h2>
      <p>Use one-shot commands when you want the same review engine without opening the shell:</p>
      <CodeBlock language="bash">{`quorate doctor
quorate review --diff changes.diff
quorate review --base main --head HEAD
quorate plan "migrate auth to passkeys"`}</CodeBlock>

      <h2>Bare text</h2>
      <p>
        Text entered without a leading <InlineCode>/</InlineCode> follows the current mode. In{" "}
        <InlineCode>review</InlineCode> mode it reviews the loaded diff with your text as the subject;
        in <InlineCode>plan</InlineCode> mode it evaluates the text as a plan. Switch with{" "}
        <InlineCode>/mode review</InlineCode> or <InlineCode>/mode plan</InlineCode>.
      </p>

      <p>
        See the full <Link to="/docs/commands">slash command reference</Link> or{" "}
        <Link to="/docs/providers">provider setup</Link>.
      </p>
    </article>
  );
}
