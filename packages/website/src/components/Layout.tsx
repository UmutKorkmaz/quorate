import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";

const NAV_LINKS = [
  { to: "/", label: "Home", end: true },
  { to: "/docs", label: "Docs", end: false }
] as const;

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  const favicon = `${import.meta.env.BASE_URL}favicon.svg`;

  return (
    <div className="site">
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/" className="site-logo" onClick={closeMenu}>
            <img src={favicon} alt="" className="site-logo-icon" width={28} height={28} />
            <span className="site-logo-text">QUORATE</span>
          </Link>

          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="site-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="menu-toggle-bar" />
            <span className="menu-toggle-bar" />
            <span className="menu-toggle-bar" />
          </button>

          <nav
            id="site-nav"
            className={`site-nav${menuOpen ? " site-nav-open" : ""}`}
            aria-label="Primary"
          >
            {NAV_LINKS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  isActive ? "nav-link nav-link-active" : "nav-link"
                }
                onClick={closeMenu}
              >
                {item.label}
              </NavLink>
            ))}
            <a
              href="https://github.com/UmutKorkmaz/quorate"
              className="nav-link nav-link-external"
              target="_blank"
              rel="noopener noreferrer"
              onClick={closeMenu}
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main className="site-main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <p>
            <span className="brand-mark" aria-hidden="true">
              ◆
            </span>{" "}
            <strong>QUORATE</strong> · MIT ©{" "}
            <a href="https://github.com/UmutKorkmaz" target="_blank" rel="noopener noreferrer">
              Umut Korkmaz
            </a>
          </p>
          <div className="site-footer-links">
            <Link to="/docs">Docs</Link>
            <a href="https://www.npmjs.com/package/quorate" target="_blank" rel="noopener noreferrer">
              npm
            </a>
            <a href="https://github.com/UmutKorkmaz/quorate" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}