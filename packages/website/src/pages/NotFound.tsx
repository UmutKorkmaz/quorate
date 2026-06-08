import { Link } from "react-router-dom";
import { Seo } from "../components/Seo";

export default function NotFound() {
  return (
    <>
      <Seo title="Page not found" description="The requested Quorate page could not be found." noindex />

      <section className="not-found">
        <p className="not-found-mark" aria-hidden="true">
          ◆
        </p>
        <h1>Page not found</h1>
        <p className="lead">
          The council could not reach a quorum on this URL. It may have moved or never
          existed.
        </p>
        <div className="hero-actions">
          <Link className="btn btn-primary" to="/">
            Back to home
          </Link>
          <Link className="btn btn-secondary" to="/docs">
            Read the docs
          </Link>
        </div>
      </section>
    </>
  );
}