import { Link } from "react-router-dom";
import { DOC_FAQ_ITEMS } from "../../lib/faq-items";

export default function Faq() {
  return (
    <article className="docs-content">
      <h1>FAQ</h1>
      <p className="lead">Common questions about setup, safety, and reviews.</p>

      <div className="faq-list">
        {DOC_FAQ_ITEMS.map((item) => (
          <details key={item.question} className="faq-item">
            <summary>{item.question}</summary>
            <p className="faq-answer">{item.answer}</p>
          </details>
        ))}
      </div>

      <h2>More help</h2>
      <p>
        See <Link to="/docs/install">Install</Link>, <Link to="/docs/quickstart">Quick start</Link>, and{" "}
        <Link to="/docs/config">Configuration</Link> for step-by-step guides. Report security issues privately — see{" "}
        <a href="https://github.com/UmutKorkmaz/quorate/blob/main/SECURITY.md" target="_blank" rel="noreferrer">
          SECURITY.md
        </a>
        .
      </p>
    </article>
  );
}