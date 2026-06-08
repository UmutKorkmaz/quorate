/**
 * Source-of-truth OG artwork (1200×630). Export to `public/og.png` for social
 * crawlers — most networks do not accept SVG for og:image.
 *
 * Quick export (requires ImageMagick):
 *   npx vite build && npx resvg-js public/og.svg -o public/og.png
 * Or open `public/og.svg` in a design tool and export PNG at 1200×630.
 */
export function OgImage() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1200 630"
      role="img"
      aria-label="Quorate — a council of AI reviewers for your code"
    >
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0f1117" />
          <stop offset="100%" stopColor="#151a24" />
        </linearGradient>
        <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#6E97FF" />
          <stop offset="100%" stopColor="#8AA6FF" />
        </linearGradient>
      </defs>
      <rect width="1200" height="630" fill="url(#bg)" />
      <rect x="72" y="72" width="1056" height="486" rx="24" fill="#1a2030" stroke="#2a3348" strokeWidth="2" />
      <text x="120" y="220" fill="url(#accent)" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="88" fontWeight="700">
        Quorate
      </text>
      <text x="120" y="300" fill="#e8ecf4" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="36" fontWeight="500">
        A council of AI reviewers for your code
      </text>
      <text x="120" y="380" fill="#9aa3b8" fontFamily="ui-monospace, monospace" fontSize="28">
        npm install -g quorate
      </text>
      <text x="120" y="470" fill="#FBBF24" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="24" fontWeight="600">
        ◆ PASS · WARN · FAIL — one verdict, many models
      </text>
    </svg>
  );
}