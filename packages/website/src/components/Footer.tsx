export default function Footer() {
  return (
    <footer className="border-t border-quorate-border px-6 py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 md:flex-row">
        <div className="flex items-center gap-2.5 text-sm">
          <span className="text-quorate-accent">◆</span>
          <span className="font-semibold tracking-wider">QUORATE</span>
          <span className="text-quorate-dim">· MIT © Umut Korkmaz</span>
        </div>
        <div className="flex gap-6 text-sm text-quorate-dim">
          <a
            href="https://www.npmjs.com/package/quorate"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-quorate-accent"
          >
            npm
          </a>
          <a
            href="https://github.com/UmutKorkmaz/quorate"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-quorate-accent"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}