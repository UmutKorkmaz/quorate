import type { ReactNode } from "react";

interface SectionProps {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function Section({
  id,
  eyebrow,
  title,
  description,
  children,
  className = ""
}: SectionProps) {
  return (
    <section id={id} className={`relative px-6 py-20 md:py-28 ${className}`}>
      <div className="mx-auto max-w-6xl">
        {eyebrow ? (
          <div className="mb-4 flex items-center gap-3">
            <span
              className="h-px w-6 rounded-full"
              style={{ background: "linear-gradient(90deg, rgba(110,151,255,0.7), rgba(110,151,255,0.2))" }}
              aria-hidden
            />
            <p className="font-mono text-xs tracking-[0.2em] text-quorate-accent uppercase">
              {eyebrow}
            </p>
          </div>
        ) : null}
        <h2 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">{title}</h2>
        {description ? (
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-quorate-muted">
            {description}
          </p>
        ) : null}
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}
