import { Link } from "react-router";
import { CodeBlock } from "../../components/CodeBlock";

import { InlineCode } from "../../components/InlineCode";

export default function Install() {
  return (
    <article className="docs-content">
      <h1>Install</h1>
      <p className="lead">
        Quorate is published on npm as <InlineCode>quorate</InlineCode>. Requires{" "}
        <strong>Node ≥ 22</strong>.
      </p>

      <h2>Global install</h2>
      <CodeBlock language="bash">{`npm install -g quorate
quorate`}</CodeBlock>
      <p>
        Running <InlineCode>quorate</InlineCode> with no arguments opens the interactive shell.
      </p>

      <h2>Verify your setup</h2>
      <CodeBlock language="bash">quorate doctor</CodeBlock>
      <p>
        <InlineCode>quorate doctor</InlineCode> reports council readiness as a verdict-style
        checklist — environment checks (Node, git, gh), each provider&apos;s state, and a closing
        verdict that names the next command.
      </p>

      <h2>Next steps</h2>
      <p>
        Continue with the <Link to="/docs/quickstart">quick start guide</Link> or read about{" "}
        <Link to="/docs/providers">providers</Link>.
      </p>
    </article>
  );
}
