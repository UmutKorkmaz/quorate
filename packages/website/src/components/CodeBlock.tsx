import { useCallback, useMemo, useState, type ReactNode } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-json";

interface CodeBlockProps {
  children: ReactNode;
  language?: string;
}

const LANG_ALIASES: Record<string, string> = {
  sh: "bash",
  shell: "bash",
  yml: "yaml"
};

function extractText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractText).join("");
  return String(children ?? "");
}

export function CodeBlock({ children, language = "bash" }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const text = extractText(children).trimEnd();
  const lang = LANG_ALIASES[language] ?? language;

  // Prism highlights synchronously; null falls back to plain monospace for
  // `text`/unknown languages so nothing ever renders blank.
  const highlighted = useMemo(() => {
    const grammar = Prism.languages[lang];
    if (!grammar) return null;
    try {
      return Prism.highlight(text, grammar, lang);
    } catch {
      return null;
    }
  }, [text, lang]);

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
      <pre className={`code-block language-${lang}`} data-language={language}>
        {highlighted ? (
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <code>{children}</code>
        )}
      </pre>
    </div>
  );
}
