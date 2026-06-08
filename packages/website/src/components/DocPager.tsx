import { Link, useLocation } from "react-router-dom";
import { DOC_LABELS, DOC_PATHS, type DocPath } from "./DocNav";

export function DocPager() {
  const { pathname } = useLocation();
  const index = DOC_PATHS.indexOf(pathname as DocPath);
  if (index < 0) return null;

  const prev = index > 0 ? DOC_PATHS[index - 1] : undefined;
  const next = index < DOC_PATHS.length - 1 ? DOC_PATHS[index + 1] : undefined;
  if (!prev && !next) return null;

  return (
    <nav className="docs-pager" aria-label="Page navigation">
      {prev ? (
        <Link to={prev} className="docs-pager-link">
          <span className="docs-pager-dir">Previous</span>
          <span className="docs-pager-title">{DOC_LABELS[prev]}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link to={next} className="docs-pager-link docs-pager-link-next">
          <span className="docs-pager-dir">Next</span>
          <span className="docs-pager-title">{DOC_LABELS[next]}</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}