import * as vscode from "vscode";
import type { CouncilReport, Finding, Severity } from "./cli";
import { resolveFindingPath } from "./cli";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

/** Overview-ruler + gutter accent per severity (matches the Chamber palette). */
const RULER_COLOR: Record<Severity, string> = {
  critical: "#fb7185",
  high: "#f87171",
  medium: "#fbbf24",
  low: "#38bdf8",
  info: "#7c8597"
};

/**
 * Native editor decorations for Quorate findings: a colored severity dot in the
 * gutter, an overview-ruler mark, and a dimmed inline summary after the line —
 * so findings read as first-class editor annotations, not just Problems entries.
 * Paired with a hover provider for the full finding detail.
 */
export class FindingDecorations {
  private readonly types: Record<Severity, vscode.TextEditorDecorationType>;
  /** Resolved-absolute-path -> findings on that file, for the current report. */
  private byPath = new Map<string, Finding[]>();

  constructor(extensionUri: vscode.Uri) {
    this.types = Object.fromEntries(
      SEVERITIES.map((severity) => [
        severity,
        vscode.window.createTextEditorDecorationType({
          gutterIconPath: vscode.Uri.joinPath(extensionUri, "media", "severity", `${severity}.svg`),
          gutterIconSize: "contain",
          overviewRulerColor: RULER_COLOR[severity],
          overviewRulerLane: vscode.OverviewRulerLane.Right,
          isWholeLine: false
        })
      ])
    ) as Record<Severity, vscode.TextEditorDecorationType>;
  }

  /** Index a report's findings by resolved path so decorations + hovers can use it. */
  setReport(report: CouncilReport | undefined, bases: string[]): void {
    this.byPath = new Map();
    for (const finding of report?.findings ?? []) {
      if (!finding.file) continue;
      const path = resolveFindingPath(finding.file, bases);
      const list = this.byPath.get(path) ?? [];
      list.push(finding);
      this.byPath.set(path, list);
    }
  }

  /** Findings on a given document line (0-based), for the hover provider. */
  findingsAt(documentPath: string, zeroBasedLine: number): Finding[] {
    return (this.byPath.get(documentPath) ?? []).filter((f) => Math.max(0, (f.line ?? 1) - 1) === zeroBasedLine);
  }

  /** Re-apply decorations to every visible editor. */
  refresh(): void {
    for (const editor of vscode.window.visibleTextEditors) this.applyTo(editor);
  }

  applyTo(editor: vscode.TextEditor): void {
    const findings = this.byPath.get(editor.document.uri.fsPath);
    for (const severity of SEVERITIES) {
      const options: vscode.DecorationOptions[] = (findings ?? [])
        .filter((f) => f.severity === severity)
        .map((f) => {
          const line = Math.min(Math.max(0, (f.line ?? 1) - 1), editor.document.lineCount - 1);
          return {
            range: editor.document.lineAt(line).range,
            renderOptions: {
              after: {
                contentText: `   ◆ ${f.title}`,
                color: new vscode.ThemeColor("editorCodeLens.foreground"),
                fontStyle: "italic"
              }
            }
          };
        });
      editor.setDecorations(this.types[severity], options);
    }
  }

  clear(): void {
    this.byPath = new Map();
    for (const editor of vscode.window.visibleTextEditors) {
      for (const severity of SEVERITIES) editor.setDecorations(this.types[severity], []);
    }
  }

  dispose(): void {
    for (const severity of SEVERITIES) this.types[severity].dispose();
  }
}

/** A rich hover for the finding(s) on a line, with Fix / Ignore command links. */
export function findingHover(findings: Finding[], documentUri: vscode.Uri): vscode.Hover | undefined {
  if (findings.length === 0) return undefined;
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;
  for (const f of findings) {
    const agreed = f.agreedBy?.length ? ` · agreed by ${f.agreedBy.join(", ")}` : "";
    md.appendMarkdown(`$(law) **Quorate** — \`${f.severity.toUpperCase()}\`${f.role ? ` · ${f.role}` : ""}${agreed}\n\n`);
    md.appendMarkdown(`**${escapeMd(f.title)}**\n\n${escapeMd(f.body)}\n\n`);
    if (f.suggestion) md.appendMarkdown(`_Suggestion:_ ${escapeMd(f.suggestion)}\n\n`);
    const suppressArgs = encodeURIComponent(JSON.stringify([documentUri.toString(), Math.max(0, (f.line ?? 1) - 1)]));
    md.appendMarkdown(
      `[$(wrench) Fix with agent](command:quorate.fixFinding) · ` +
        `[$(eye-closed) Ignore](command:quorate.suppressFinding?${suppressArgs})\n\n`
    );
    md.appendMarkdown("---\n\n");
  }
  return new vscode.Hover(md);
}

function escapeMd(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-!|])/g, "\\$1");
}
