import { useState } from "react";
import { Outlet, useLocation } from "react-router";
import { DocNav, DOC_LABELS, DOC_PATHS, type DocPath } from "../../components/DocNav";
import { DocPager } from "../../components/DocPager";
import { Seo } from "../../components/Seo";
import { DOC_DESCRIPTIONS } from "../../lib/doc-seo";
import { faqPageJsonLd } from "../../lib/faq-items";

export default function DocsLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();
  const docPath = DOC_PATHS.includes(pathname as DocPath) ? (pathname as DocPath) : undefined;

  return (
    <div className="docs-shell">
      {docPath ? (
        <Seo
          title={DOC_LABELS[docPath]}
          description={DOC_DESCRIPTIONS[docPath]}
          path={docPath}
          jsonLd={docPath === "/docs/faq" ? faqPageJsonLd : undefined}
        />
      ) : null}
      <button
        type="button"
        className="docs-nav-toggle"
        aria-expanded={navOpen}
        onClick={() => setNavOpen((open) => !open)}
      >
        {navOpen ? "Hide navigation" : "Browse docs"}
      </button>

      <div className="docs-shell-inner">
        <aside className={`docs-sidebar${navOpen ? " docs-sidebar-open" : ""}`}>
          <p className="docs-sidebar-label">Documentation</p>
          <DocNav onNavigate={() => setNavOpen(false)} />
        </aside>

        <div className="docs-main">
          <Outlet />
          <DocPager />
        </div>
      </div>
    </div>
  );
}
