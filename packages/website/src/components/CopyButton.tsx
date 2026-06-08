import { useCallback, useState } from "react";

interface CopyButtonProps {
  text: string;
  className?: string;
  variant?: "default" | "hero";
}

export function CopyButton({ text, className = "", variant = "default" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [text]);

  if (variant === "hero") {
    return (
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy install command"}
        className={`group hero-cta-primary ${className}`}
      >
        <span className="text-quorate-amber font-bold">$</span>
        <span className="tracking-wide">{text}</span>
        <span
          className={`ml-1 rounded-md border px-2 py-0.5 text-xs transition-colors ${
            copied
              ? "border-quorate-pass/50 text-quorate-pass"
              : "border-quorate-border/60 text-quorate-dim group-hover:border-quorate-accent/40 group-hover:text-quorate-accent"
          }`}
        >
          {copied ? "Copied!" : "Copy"}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      className={`group inline-flex items-center gap-2 rounded-lg border border-quorate-border bg-quorate-elevated/80 px-3 py-2 font-mono text-sm text-quorate-muted transition hover:border-quorate-accent/50 hover:text-white ${className}`}
    >
      <span className="text-quorate-accent">$</span>
      <span>{text}</span>
      <span className="ml-1 rounded border border-quorate-border bg-quorate-surface px-2 py-0.5 text-xs text-quorate-dim transition group-hover:border-quorate-accent/40 group-hover:text-quorate-accent">
        {copied ? "Copied!" : "Copy"}
      </span>
    </button>
  );
}
