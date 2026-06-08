import type { ReactNode } from "react";

interface InlineCodeProps {
  children: ReactNode;
}

export function InlineCode({ children }: InlineCodeProps) {
  return <code className="inline-code">{children}</code>;
}