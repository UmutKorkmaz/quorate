import { useCallback, useState, type ReactNode } from "react";

interface CodeBlockProps {
  children: ReactNode;
  language?: string;
}

function extractText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractText).join("");
  return String(children ?? "");
}

export function CodeBlock({ children, language = "bash" }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const text = extractText(children).trimEnd();

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, [text]);

  return (
    <div className="code-block-wrap">
      <div className="code-block-header">
        <span className="code-block-lang">{language}</span>
        <button
          type="button"
          onClick={copy}
          className={`code-block-copy${copied ? " code-block-copy-done" : ""}`}
          aria-label="Copy code"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="code-block" data-language={language}>
        <code>{children}</code>
      </pre>
    </div>
  );
}