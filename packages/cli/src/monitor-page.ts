/**
 * The single-file browser dashboard for `quorate monitor --web`.
 *
 * Embedded as a string on purpose: nothing is served from disk (no static
 * bundle, no path handling, no traversal surface) and the CLI bin stays
 * self-contained. The page is plain DOM + EventSource — the server pushes
 * full snapshots, so client state is a straight render of the last message.
 * All dynamic values go through textContent (never innerHTML) to keep agent
 * output from becoming markup.
 */
export const MONITOR_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Quorate monitor</title>
<style>
  :root {
    --bg: oklch(16% 0.02 260);
    --surface: oklch(21% 0.02 260);
    --surface-2: oklch(25% 0.03 260);
    --text: oklch(92% 0.01 260);
    --dim: oklch(65% 0.02 260);
    --accent: oklch(75% 0.15 200);
    --pass: oklch(75% 0.17 150);
    --fail: oklch(68% 0.19 25);
    --warn: oklch(80% 0.15 85);
    --radius: 10px;
    --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem clamp(1rem, 4vw, 3rem);
    background: var(--bg); color: var(--text);
    font: 15px/1.5 var(--mono);
  }
  header { display: flex; align-items: baseline; gap: 0.75rem; margin-bottom: 1.5rem; }
  header h1 { font-size: 1.1rem; margin: 0; color: var(--accent); letter-spacing: 0.02em; }
  header .sub { color: var(--dim); font-size: 0.85rem; }
  #status { margin-left: auto; font-size: 0.8rem; color: var(--dim); }
  #status.live::before { content: "●"; color: var(--pass); margin-right: 0.4rem; }
  #status.dead::before { content: "●"; color: var(--fail); margin-right: 0.4rem; }
  .empty { color: var(--dim); padding: 2rem 0; }
  .run {
    background: var(--surface); border-radius: var(--radius);
    padding: 1rem 1.25rem; margin-bottom: 1rem;
    border: 1px solid oklch(30% 0.02 260);
  }
  .run-head { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: baseline; cursor: pointer; }
  .run-head .repo { font-weight: 700; }
  .run-head .meta { color: var(--dim); font-size: 0.85rem; }
  .badge { font-size: 0.75rem; padding: 0.1rem 0.5rem; border-radius: 999px; border: 1px solid; }
  .badge.running { color: var(--accent); border-color: var(--accent); }
  .badge.done { color: var(--pass); border-color: var(--pass); }
  .badge.error, .badge.stale { color: var(--fail); border-color: var(--fail); }
  .verdict.pass { color: var(--pass); } .verdict.warn { color: var(--warn); } .verdict.fail { color: var(--fail); }
  .lanes { margin-top: 0.75rem; display: none; }
  .run.open .lanes { display: block; }
  .lane { padding: 0.35rem 0.5rem; border-radius: 6px; display: flex; gap: 0.6rem; align-items: baseline; cursor: pointer; }
  .lane:hover { background: var(--surface-2); }
  .lane .key { min-width: 14rem; }
  .lane .key .role { color: var(--dim); }
  .lane .state { font-size: 0.85rem; }
  .lane .state.running { color: var(--accent); } .lane .state.done { color: var(--pass); }
  .lane .state.err { color: var(--fail); } .lane .state.queued { color: var(--dim); }
  .lane .preview { color: var(--dim); font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tail {
    display: none; margin: 0.25rem 0 0.6rem 1rem; padding: 0.6rem 0.8rem;
    background: oklch(13% 0.02 260); border-radius: 6px;
    font-size: 0.8rem; color: var(--dim); white-space: pre-wrap; word-break: break-word;
    max-height: 18rem; overflow-y: auto;
  }
  .tail.open { display: block; }
  .lane.gate { border-left: 3px solid var(--warn); background: oklch(23% 0.03 85 / 0.35); }
  .lane.gate .key strong { color: var(--warn); }
  .actions { margin-left: auto; display: flex; gap: 0.4rem; }
  .actions button {
    font: 0.75rem var(--mono); color: var(--dim);
    background: var(--surface-2); border: 1px solid oklch(35% 0.02 260);
    border-radius: 6px; padding: 0.15rem 0.6rem; cursor: pointer;
  }
  .actions button:hover { color: var(--text); border-color: var(--accent); }
  #toast { position: fixed; bottom: 1rem; right: 1rem; background: var(--surface-2);
    padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.85rem; display: none; }
</style>
</head>
<body>
<header>
  <h1>Quorate monitor</h1>
  <span class="sub">live runs on this machine</span>
  <span id="status">connecting…</span>
</header>
<main id="runs"><div class="empty">Waiting for data…</div></main>
<div id="toast"></div>
<script>
  "use strict";
  const openRuns = new Set();
  const openTails = new Set();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function laneStateClass(lane) {
    if (lane.state === "done") return lane.status && lane.status !== "ok" ? "err" : "done";
    return lane.state;
  }

  function laneStateText(lane) {
    if (lane.state === "done") return lane.note || lane.status || "done";
    return lane.state;
  }

  function render(data) {
    const root = document.getElementById("runs");
    root.replaceChildren();
    if (!data.runs.length) {
      root.append(el("div", "empty", "No live runs. Start one with quorate review in any terminal."));
      return;
    }
    for (const run of data.runs) {
      const card = el("section", "run" + (openRuns.has(run.runId) ? " open" : ""));
      const head = el("div", "run-head");
      head.append(el("span", "repo", run.repo));
      head.append(el("span", "badge " + run.status, run.status));
      head.append(el("span", "meta", run.mode + " · " + run.lanes.length + " lanes · " + run.subject));
      if (run.verdict) {
        head.append(el("span", "verdict " + run.verdict, run.verdict.toUpperCase() + (run.degraded ? " (degraded)" : "")));
      }
      const actions = el("span", "actions");
      if (run.status === "running") {
        const abort = el("button", "", "abort");
        abort.addEventListener("click", (event) => { event.stopPropagation(); control("abort", run.runId); });
        actions.append(abort);
      } else {
        const rerun = el("button", "", "rerun");
        rerun.addEventListener("click", (event) => { event.stopPropagation(); control("rerun", run.runId); });
        actions.append(rerun);
      }
      head.append(actions);
      head.addEventListener("click", () => {
        openRuns.has(run.runId) ? openRuns.delete(run.runId) : openRuns.add(run.runId);
        card.classList.toggle("open");
      });
      card.append(head);

      const lanes = el("div", "lanes");
      for (const lane of run.lanes) {
        const tailId = run.runId + "/" + lane.laneKey;
        const row = el("div", "lane" + (lane.gate ? " gate" : ""));
        const key = el("span", "key");
        key.append(el("strong", "", lane.providerId));
        key.append(el("span", "role", ":" + lane.role));
        row.append(key);
        row.append(el("span", "state " + laneStateClass(lane), laneStateText(lane)));
        if (lane.state === "running" && lane.preview) row.append(el("span", "preview", lane.preview));
        if (lane.error) row.append(el("span", "state err", lane.error));
        const tail = el("div", "tail" + (openTails.has(tailId) ? " open" : ""),
          lane.tail.length ? lane.tail.join("\\n") : "no output captured (QUORATE_JSON_CHUNKS=1 enables tails)");
        row.addEventListener("click", () => {
          openTails.has(tailId) ? openTails.delete(tailId) : openTails.add(tailId);
          tail.classList.toggle("open");
        });
        lanes.append(row, tail);
      }
      card.append(lanes);
      root.append(card);
    }
  }

  function toast(message) {
    const node = document.getElementById("toast");
    node.textContent = message;
    node.style.display = "block";
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.style.display = "none"; }, 4000);
  }

  async function control(action, runId) {
    try {
      const response = await fetch("/control?token=" + encodeURIComponent(token || ""), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, runId })
      });
      const result = await response.json();
      toast(result.message || (result.ok ? action + " ok" : action + " failed"));
    } catch {
      toast(action + " request failed");
    }
  }

  const status = document.getElementById("status");
  const token = new URLSearchParams(location.search).get("token");
  const source = new EventSource("/events?token=" + encodeURIComponent(token || ""));
  source.onopen = () => { status.textContent = "live"; status.className = "live"; };
  source.onerror = () => { status.textContent = "disconnected"; status.className = "dead"; };
  source.onmessage = (message) => {
    try { render(JSON.parse(message.data)); } catch { /* keep last good frame */ }
  };
</script>
</body>
</html>
`;
