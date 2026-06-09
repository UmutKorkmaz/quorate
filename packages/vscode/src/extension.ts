import { spawn } from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * The Quorate VS Code extension drives the installed `quorate` CLI and parses its
 * `--json` NDJSON stream (the last stdout line is the full CouncilReport), then
 * surfaces findings as editor diagnostics and the verdict in the status bar.
 * It shares exact shapes with @quorate/core via these type-only interfaces.
 */
type Severity = "critical" | "high" | "medium" | "low" | "info";
type Verdict = "pass" | "warn" | "fail";

interface Finding {
  severity: Severity;
  title: string;
  body: string;
  file?: string;
  line?: number;
  providerId?: string;
  role?: string;
  agreedBy?: string[];
  confidence?: number;
}

interface CouncilReport {
  verdict: Verdict;
  summary: string;
  findings: Finding[];
  providerResults: Array<{ providerId: string; role: string; status: string }>;
  metadata: { degraded: boolean };
}

const SEVERITY: Record<Severity, vscode.DiagnosticSeverity> = {
  critical: vscode.DiagnosticSeverity.Error,
  high: vscode.DiagnosticSeverity.Error,
  medium: vscode.DiagnosticSeverity.Warning,
  low: vscode.DiagnosticSeverity.Information,
  info: vscode.DiagnosticSeverity.Hint
};

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection("quorate");

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = "$(law) Quorate";
  status.tooltip = "Run the Quorate review council on your current change";
  status.command = "quorate.reviewChanges";
  status.show();

  context.subscriptions.push(
    diagnostics,
    status,
    vscode.commands.registerCommand("quorate.reviewChanges", () =>
      runReview(diagnostics, status)
    ),
    vscode.commands.registerCommand("quorate.clearFindings", () => {
      diagnostics.clear();
      status.text = "$(law) Quorate";
    })
  );
}

export function deactivate(): void {
  /* DiagnosticCollection + status bar are disposed via context.subscriptions. */
}

async function runReview(
  diagnostics: vscode.DiagnosticCollection,
  status: vscode.StatusBarItem
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage("Quorate: open a folder before running a review.");
    return;
  }
  const cwd = folder.uri.fsPath;

  const cfg = vscode.workspace.getConfiguration("quorate");
  const cliPath = cfg.get<string>("cliPath", "quorate");
  const base = cfg.get<string>("baseBranch", "main");
  const providers = cfg.get<string>("providers", "").trim();

  const args = ["review", "--base", base, "--json"];
  if (providers) args.push("--providers", providers);

  diagnostics.clear();
  status.text = "$(sync~spin) Quorate reviewing…";

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Quorate — convening the council…",
      cancellable: true
    },
    (_progress, token) =>
      new Promise<void>((resolve) => {
        const child = spawn(cliPath, args, { cwd, shell: false });
        let stdout = "";
        let stderr = "";

        token.onCancellationRequested(() => child.kill());
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        child.on("error", (err) => {
          status.text = "$(law) Quorate";
          void vscode.window.showErrorMessage(
            `Quorate: could not run "${cliPath}". Install it with \`npm i -g quorate\` or set quorate.cliPath. (${err.message})`
          );
          resolve();
        });

        child.on("close", () => {
          if (token.isCancellationRequested) {
            status.text = "$(law) Quorate";
            resolve();
            return;
          }
          const report = parseReport(stdout);
          if (!report) {
            status.text = "$(law) Quorate";
            const reason = stderr.trim().split("\n").filter(Boolean).pop() ?? "no report produced";
            void vscode.window.showWarningMessage(`Quorate: ${reason}`);
            resolve();
            return;
          }
          applyReport(report, diagnostics, cwd, status);
          resolve();
        });
      })
  );
}

/** The final NDJSON stdout line is the full CouncilReport; scan from the end. */
function parseReport(stdout: string): CouncilReport | undefined {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as unknown;
      if (isCouncilReport(parsed)) return parsed;
    } catch {
      /* not the report line */
    }
  }
  return undefined;
}

function isCouncilReport(value: unknown): value is CouncilReport {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.verdict === "string" &&
    typeof candidate.summary === "string" &&
    Array.isArray(candidate.findings) &&
    Array.isArray(candidate.providerResults) &&
    typeof candidate.metadata === "object" &&
    candidate.metadata !== null
  );
}

function tierWord(severity: Severity): string {
  if (severity === "critical" || severity === "high") return "FAIL";
  if (severity === "medium") return "WARN";
  return "NOTE";
}

function applyReport(
  report: CouncilReport,
  diagnostics: vscode.DiagnosticCollection,
  cwd: string,
  status: vscode.StatusBarItem
): void {
  const byFile = new Map<string, vscode.Diagnostic[]>();

  for (const finding of report.findings) {
    if (!finding.file) continue;
    const line = Math.max(0, (finding.line ?? 1) - 1);
    const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
    const agreed = finding.agreedBy?.length ? ` · agreed by ${finding.agreedBy.join(", ")}` : "";
    const confidence = finding.confidence != null ? ` · confidence ${finding.confidence.toFixed(2)}` : "";
    const message = `${tierWord(finding.severity)} ${finding.severity.toUpperCase()} — ${finding.body || finding.title}${agreed}${confidence}`;

    const diagnostic = new vscode.Diagnostic(range, message, SEVERITY[finding.severity]);
    diagnostic.source = "quorate";
    if (finding.role) diagnostic.code = finding.role;

    const target = path.isAbsolute(finding.file) ? finding.file : path.join(cwd, finding.file);
    const list = byFile.get(target) ?? [];
    list.push(diagnostic);
    byFile.set(target, list);
  }

  diagnostics.clear();
  for (const [file, diags] of byFile) {
    diagnostics.set(vscode.Uri.file(file), diags);
  }

  const verdict = report.verdict.toUpperCase();
  const degraded = report.metadata.degraded ? " (degraded — heuristic only)" : "";
  const count = report.findings.length;
  const summary = `Quorate: ${verdict}${degraded} · ${count} finding${count === 1 ? "" : "s"}`;

  status.text =
    report.verdict === "fail"
      ? `$(error) Quorate FAIL`
      : report.verdict === "warn"
        ? `$(warning) Quorate WARN`
        : `$(check) Quorate PASS`;

  const show =
    report.verdict === "fail"
      ? vscode.window.showErrorMessage
      : report.verdict === "warn"
        ? vscode.window.showWarningMessage
        : vscode.window.showInformationMessage;

  void show(summary, "Show Problems").then((picked) => {
    if (picked) void vscode.commands.executeCommand("workbench.actions.view.problems");
  });
}
