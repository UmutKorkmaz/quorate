// SPDX-License-Identifier: Apache-2.0
//
// RunListView.swift — the SwiftUI body of the panel.
//
// Approvals FIRST as amber cards (tool, summary, source repo, countdown,
// Approve/Deny). Then runs grouped native vs external (badge external · source),
// lanes with state dots, subagent children indented, per-run Jump/Abort/Rerun,
// verdict chips colored pass/warn/fail. Footer with today's stats + conn dot.

import SwiftUI

struct RunListView: View {
    @EnvironmentObject private var connection: ServerConnection
    @EnvironmentObject private var settings: SettingsStore
    @State private var controlClient = ControlClient()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                approvalsSection
                Divider()
                runsSection
                Divider()
                externalSection
                footer
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color(NSColor.windowBackgroundColor))
    }

    @ViewBuilder
    private var approvalsSection: some View {
        let approvals = connection.snapshot.approvals ?? []
        if !approvals.isEmpty {
            Text("Approvals")
                .font(.headline)
                .foregroundStyle(.orange)
            ForEach(approvals) { approval in
                ApprovalCard(approval: approval) { decision in
                    Task { await controlClient.send(decision, id: approval.id) }
                }
            }
        }
    }

    @ViewBuilder
    private var runsSection: some View {
        let runs = connection.snapshot.runs
        if runs.isEmpty {
            Text("No live runs.")
                .foregroundStyle(.secondary)
        } else {
            Text("Runs")
                .font(.headline)
            ForEach(runs) { run in
                RunCard(run: run) { action in
                    Task { await controlClient.send(action, runId: run.runId) }
                }
            }
        }
    }

    @ViewBuilder
    private var externalSection: some View {
        let external = connection.snapshot.external ?? []
        if !external.isEmpty {
            Text("Detected: " + external.map { "\($0.name)(\($0.pid))" }.joined(separator: ", "))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var footer: some View {
        HStack {
            Circle()
                .fill(connection.connected ? Color.green : Color.gray)
                .frame(width: 8, height: 8)
            Text(connection.connected ? "connected" : "disconnected")
                .foregroundStyle(.secondary)
                .font(.caption)
            Spacer()
            if let today = connection.snapshot.stats?.today {
                Text("today: \(today.runs ?? 0) run(s)")
                    .foregroundStyle(.secondary)
                    .font(.caption)
            }
        }
    }
}

private struct ApprovalCard: View {
    let approval: Approval
    let onDecide: (String) -> Void // "approve" or "deny"

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("⏳ \(approval.toolName)").bold().foregroundStyle(.orange)
                Spacer()
                Text(approval.source ?? "external").foregroundStyle(.secondary).font(.caption)
            }
            Text(approval.summary).font(.body)
            Text("expires \(approval.expiresAt)").foregroundStyle(.secondary).font(.caption)
            HStack(spacing: 8) {
                Button("Approve") { onDecide("approve") }
                Button("Deny") { onDecide("deny") }
            }
            .buttonStyle(.bordered)
        }
        .padding(8)
        .background(Color.orange.opacity(0.08))
        .cornerRadius(8)
    }
}

private struct RunCard: View {
    let run: Run
    let onControl: (String) -> Void // action string

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(run.repo).bold()
                if run.isExternal, let source = run.source {
                    Text("external · \(source)")
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Color.secondary.opacity(0.15))
                        .cornerRadius(6)
                }
                Spacer()
                Text(run.status)
                    .foregroundStyle(statusColor(run.status))
                    .font(.caption)
                if let verdict = run.verdict {
                    Text(verdict.uppercased())
                        .font(.caption2)
                        .padding(.horizontal, 4)
                        .background(verdictColor(verdict).opacity(0.15))
                        .cornerRadius(4)
                }
            }
            Text(run.subject).foregroundStyle(.secondary).font(.caption)
            ForEach(run.lanes) { lane in
                LaneRow(lane: lane)
            }
            ForEach(run.children ?? []) { child in
                HStack {
                    Text("└").foregroundStyle(.secondary)
                    Text("\(child.repo) · \(child.status)").font(.caption).foregroundStyle(.secondary)
                }
                .padding(.leading, 16)
            }
            HStack(spacing: 8) {
                Button("Jump") { onControl("jump") }
                if run.status == "running" {
                    Button("Abort") { onControl("abort") }
                } else {
                    Button("Rerun") { onControl("rerun") }
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .padding(8)
        .background(Color(NSColor.controlBackgroundColor))
        .cornerRadius(8)
    }

    private func statusColor(_ s: String) -> Color {
        switch s {
        case "running": return .accentColor
        case "done": return .green
        case "error", "stale": return .red
        default: return .secondary
        }
    }

    private func verdictColor(_ v: String) -> Color {
        switch v.lowercased() {
        case "pass": return .green
        case "warn": return .orange
        case "fail": return .red
        default: return .secondary
        }
    }
}

private struct LaneRow: View {
    let lane: Lane

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(dotColor(lane.state))
                .frame(width: 7, height: 7)
            Text("\(lane.providerId):\(lane.role)").font(.caption)
            Spacer()
            Text(lane.note ?? lane.state)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private func dotColor(_ state: String) -> Color {
        switch state {
        case "running": return .accentColor
        case "done": return .green
        case "error": return .red
        default: return .gray
        }
    }
}
