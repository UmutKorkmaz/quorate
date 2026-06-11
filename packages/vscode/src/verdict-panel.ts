import * as vscode from "vscode";
import type { CouncilReport, Finding, ProviderResult } from "./cli";

// ─────────────────────────── helpers ───────────────────────────

function escHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

type FileGroup = { file: string; findings: Finding[] };

function groupByFile(findings: Finding[]): FileGroup[] {
  const map = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.file ?? "General";
    const existing = map.get(key) ?? [];
    map.set(key, [...existing, f]);
  }
  return [...map.entries()].map(([file, findings]) => ({ file, findings }));
}

// ─────────────────────────── palette ───────────────────────────

const VERDICT_COLOR: Record<string, string> = {
  pass: "#34d399",
  warn: "#fbbf24",
  fail: "#f87171"
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#fb7185",
  high: "#f87171",
  medium: "#fbbf24",
  low: "#38bdf8",
  info: "#7c8597"
};

// ─────────────────────────── html builders ───────────────────────────

function renderProviderChips(results: ProviderResult[]): string {
  if (results.length === 0) return "";
  const chips = results
    .map((pr) => {
      const ok = pr.status === "ok";
      const skipped = pr.status === "skipped";
      const color = ok ? "#34d399" : skipped ? "#7c8597" : "#f87171";
      const label = escHtml(`${pr.providerId}:${pr.role}`);
      const count = pr.findings?.length ?? 0;
      const countText = ok ? ` · ${count}` : "";
      return `<span class="chip" style="border-color:${color};color:${color}" title="${escHtml(pr.error ?? pr.status)}">
        <span class="chip-dot" style="background:${color}"></span>${label}${countText}
      </span>`;
    })
    .join("");
  return `<div class="chips">${chips}</div>`;
}

function renderFindingRow(f: Finding, globalIndex: number): string {
  const sev = f.severity;
  const sevColor = SEVERITY_COLOR[sev] ?? "#7c8597";
  const title = escHtml(f.title);
  const body = escHtml(f.body ?? "");
  const suggestion = f.suggestion ? escHtml(f.suggestion) : "";
  const agreedBy = f.agreedBy?.length ? `agreed by ${escHtml(f.agreedBy.join(", "))}` : "";
  const role = f.role ? escHtml(f.role) : "";
  const hasMeta = role || agreedBy;
  const hasDetails = body || suggestion;
  const detailsId = `d-${globalIndex}`;

  const fileAttr = f.file
    ? `data-file="${escHtml(f.file)}" data-line="${f.line ?? 1}"`
    : "";
  const clickable = f.file ? ` finding-link` : "";

  return `<div class="finding${clickable}" ${fileAttr} role="listitem">
    <div class="finding-header">
      <span class="sev-chip" style="background:${sevColor}22;color:${sevColor};border:1px solid ${sevColor}44">${escHtml(sev.toUpperCase())}</span>
      <span class="finding-title">${title}</span>
      ${hasMeta ? `<span class="finding-meta">${[role, agreedBy].filter(Boolean).join(" · ")}</span>` : ""}
      ${hasDetails ? `<button class="toggle-btn" aria-expanded="false" aria-controls="${detailsId}" onclick="toggleDetail('${detailsId}',this)">▸</button>` : ""}
    </div>
    ${hasDetails ? `<div class="finding-details" id="${detailsId}" hidden>
      ${body ? `<p class="finding-body">${body}</p>` : ""}
      ${suggestion ? `<p class="finding-suggestion"><strong>Suggestion:</strong> ${suggestion}</p>` : ""}
    </div>` : ""}
  </div>`;
}

function renderFileGroup(group: FileGroup, startIndex: number): string {
  const file = escHtml(group.file);
  const isGeneral = group.file === "General";
  const fileHeader = isGeneral
    ? `<div class="file-header"><span class="file-icon">&#9632;</span><span class="file-name">${file}</span></div>`
    : `<button class="file-header file-link" data-file="${file}" data-line="1" onclick="openFile(this)" title="Open ${file}">
        <span class="file-icon">&#9632;</span><span class="file-name">${file}</span>
        <span class="file-count">${group.findings.length}</span>
       </button>`;

  const rows = group.findings
    .map((f, i) => renderFindingRow(f, startIndex + i))
    .join("");

  return `<section class="file-group">
    ${fileHeader}
    <div class="findings-list" role="list">${rows}</div>
  </section>`;
}

function buildHtml(report: CouncilReport, n: string): string {
  const v = report.verdict;
  const vColor = VERDICT_COLOR[v] ?? "#7c8597";
  const vLabel = escHtml(v.toUpperCase());
  const findingCount = report.findings.length;
  const reviewerCount = report.providerResults.length;
  const degraded = report.metadata.degraded;
  const mergedBy = report.metadata.mergedBy;

  const groups = groupByFile(report.findings);
  let idx = 0;
  const groupHtml = groups
    .map((g) => {
      const html = renderFileGroup(g, idx);
      idx += g.findings.length;
      return html;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}'"/>
  <title>Quorate Verdict</title>
  <style nonce="${n}">
    :root {
      --q-bg:       var(--vscode-editor-background, #0b0f17);
      --q-surface:  var(--vscode-sideBar-background, #121826);
      --q-surface2: var(--vscode-editorGroupHeader-tabsBackground, #1a2234);
      --q-border:   var(--vscode-panel-border, #2a3348);
      --q-fg:       var(--vscode-editor-foreground, #e2e8f0);
      --q-fg-dim:   var(--vscode-descriptionForeground, #7c8597);
      --q-accent:   #6e97ff;
      --q-radius:   6px;
      --q-verdict:  ${vColor};
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 13px; }
    body {
      background: var(--q-bg);
      color: var(--q-fg);
      font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      line-height: 1.55;
      padding: 20px 24px 40px;
      max-width: 900px;
      margin: 0 auto;
    }

    /* ── verdict card ─────────────────────────────── */
    .verdict-card {
      background: var(--q-surface2);
      border: 1px solid var(--q-border);
      border-left: 3px solid var(--q-verdict);
      border-radius: var(--q-radius);
      padding: 18px 20px 16px;
      margin-bottom: 20px;
    }
    .verdict-top {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .verdict-badge {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: 0.06em;
      color: var(--q-verdict);
      line-height: 1;
    }
    .verdict-stats {
      color: var(--q-fg-dim);
      font-size: 12px;
    }
    .pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
    }
    .pill-degraded {
      background: #fbbf2422;
      color: #fbbf24;
      border: 1px solid #fbbf2444;
    }
    .pill-merged {
      background: #6e97ff22;
      color: var(--q-accent);
      border: 1px solid #6e97ff44;
    }
    .summary {
      margin-top: 10px;
      color: var(--q-fg-dim);
      font-size: 12px;
      line-height: 1.5;
    }

    /* ── reviewer chips ───────────────────────────── */
    .section-label {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--q-fg-dim);
      margin-bottom: 8px;
      margin-top: 16px;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 4px;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px;
      border-radius: 12px;
      border: 1px solid;
      font-size: 11px;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .chip-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    /* ── file groups ──────────────────────────────── */
    .findings-section {
      margin-top: 20px;
    }
    .file-group {
      margin-bottom: 16px;
    }
    .file-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: var(--q-surface2);
      border: 1px solid var(--q-border);
      border-radius: var(--q-radius) var(--q-radius) 0 0;
      cursor: default;
      width: 100%;
      text-align: left;
    }
    button.file-header {
      background: var(--q-surface2);
      color: var(--q-fg);
      border: 1px solid var(--q-border);
    }
    button.file-link {
      cursor: pointer;
    }
    button.file-link:hover {
      background: color-mix(in srgb, var(--q-accent) 8%, var(--q-surface2));
      border-color: var(--q-accent);
    }
    .file-icon { color: var(--q-accent); font-size: 9px; }
    .file-name {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      color: var(--q-accent);
      flex: 1;
    }
    .file-count {
      background: var(--q-surface);
      color: var(--q-fg-dim);
      border-radius: 10px;
      padding: 0 6px;
      font-size: 10px;
      border: 1px solid var(--q-border);
    }
    .findings-list {
      border: 1px solid var(--q-border);
      border-top: none;
      border-radius: 0 0 var(--q-radius) var(--q-radius);
      overflow: hidden;
    }

    /* ── finding rows ─────────────────────────────── */
    .finding {
      padding: 8px 12px;
      background: var(--q-surface);
      border-bottom: 1px solid var(--q-border);
    }
    .finding:last-child { border-bottom: none; }
    .finding-link { cursor: pointer; }
    .finding-link:hover { background: color-mix(in srgb, var(--q-accent) 5%, var(--q-surface)); }
    .finding-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
    }
    .sev-chip {
      flex-shrink: 0;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
    }
    .finding-title {
      flex: 1;
      font-size: 12px;
      color: var(--q-fg);
    }
    .finding-meta {
      font-size: 11px;
      color: var(--q-fg-dim);
      font-style: italic;
    }
    .toggle-btn {
      background: none;
      border: none;
      color: var(--q-fg-dim);
      cursor: pointer;
      font-size: 11px;
      padding: 0 2px;
      line-height: 1;
      transition: transform 0.15s ease;
    }
    .toggle-btn[aria-expanded="true"] { transform: rotate(90deg); }
    .finding-details {
      margin-top: 8px;
      padding: 8px 10px;
      background: var(--q-bg);
      border-radius: 4px;
      border-left: 2px solid var(--q-border);
    }
    .finding-body {
      font-size: 12px;
      color: var(--q-fg-dim);
      margin-bottom: 6px;
      white-space: pre-wrap;
    }
    .finding-suggestion {
      font-size: 12px;
      color: var(--q-fg-dim);
      white-space: pre-wrap;
    }
    .finding-suggestion strong { color: var(--q-fg); }

    /* ── footer ───────────────────────────────────── */
    .footer {
      margin-top: 28px;
      padding-top: 16px;
      border-top: 1px solid var(--q-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
    }
    .footer-note {
      font-size: 11px;
      color: var(--q-fg-dim);
    }
    .footer-actions { display: flex; gap: 8px; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 12px;
      border-radius: var(--q-radius);
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      border: 1px solid;
      transition: opacity 0.12s ease;
    }
    .btn:hover { opacity: 0.85; }
    .btn:active { opacity: 0.7; }
    .btn-primary {
      background: #6e97ff22;
      color: var(--q-accent);
      border-color: #6e97ff55;
    }
    .btn-secondary {
      background: transparent;
      color: var(--q-fg-dim);
      border-color: var(--q-border);
    }
  </style>
</head>
<body>
  <!-- verdict card -->
  <div class="verdict-card">
    <div class="verdict-top">
      <span class="verdict-badge">${vLabel}</span>
      <span class="verdict-stats">· ${findingCount} finding${findingCount === 1 ? "" : "s"} · ${reviewerCount} reviewer${reviewerCount === 1 ? "" : "s"}</span>
      ${degraded ? `<span class="pill pill-degraded">DEGRADED — heuristic only</span>` : ""}
      ${mergedBy ? `<span class="pill pill-merged">merged by ${escHtml(mergedBy)}</span>` : ""}
    </div>
    <p class="summary">${escHtml(report.summary)}</p>
  </div>

  <!-- reviewers -->
  ${reviewerCount > 0 ? `<div class="section-label">Reviewers</div>${renderProviderChips(report.providerResults)}` : ""}

  <!-- findings grouped by file -->
  ${findingCount > 0 ? `<div class="section-label findings-section">Findings</div>${groupHtml}` : `<p class="summary" style="margin-top:16px">No findings — ${vLabel === "PASS" ? "all clear." : "review complete."}</p>`}

  <!-- footer -->
  <footer class="footer">
    <span class="footer-note">Quorate multi-agent review &mdash; results are advisory</span>
    <div class="footer-actions">
      <button class="btn btn-secondary" onclick="postMsg('fix')">Fix a finding&hellip;</button>
      <button class="btn btn-primary" onclick="postMsg('rerun')">Re-run review</button>
    </div>
  </footer>

  <script nonce="${n}">
    const vscode = acquireVsCodeApi();

    function postMsg(type) {
      vscode.postMessage({ type });
    }

    function toggleDetail(id, btn) {
      const el = document.getElementById(id);
      if (!el) return;
      const hidden = el.hasAttribute('hidden');
      if (hidden) {
        el.removeAttribute('hidden');
        btn.setAttribute('aria-expanded', 'true');
      } else {
        el.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', 'false');
      }
    }

    function openFile(btn) {
      const file = btn.dataset.file;
      const line = parseInt(btn.dataset.line ?? '1', 10);
      if (file) vscode.postMessage({ type: 'open', file, line });
    }

    document.addEventListener('click', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('.finding-link') : null;
      if (!el) return;
      const file = el.dataset.file;
      const line = parseInt(el.dataset.line ?? '1', 10);
      if (file) vscode.postMessage({ type: 'open', file, line });
    });
  </script>
</body>
</html>`;
}

// ─────────────────────────── VerdictPanel ───────────────────────────

export class VerdictPanel {
  private static _instance: VerdictPanel | undefined;

  static get instance(): VerdictPanel {
    if (!VerdictPanel._instance) VerdictPanel._instance = new VerdictPanel();
    return VerdictPanel._instance;
  }

  private panel: vscode.WebviewPanel | undefined;

  private constructor() {
    // singleton — use VerdictPanel.instance
  }

  show(report: CouncilReport, extensionUri: vscode.Uri): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        "quorate.verdict",
        "Quorate Verdict",
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [extensionUri]
        }
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((msg: { type: string; file?: string; line?: number }) => {
        switch (msg.type) {
          case "open":
            if (msg.file) {
              void vscode.commands.executeCommand("quorate.openFinding", msg.file, msg.line ?? 1);
            }
            break;
          case "rerun":
            void vscode.commands.executeCommand("quorate.run");
            break;
          case "fix":
            void vscode.commands.executeCommand("quorate.fixFinding");
            break;
        }
      });
    }
    const n = nonce();
    this.panel.webview.html = buildHtml(report, n);
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    VerdictPanel._instance = undefined;
  }
}
