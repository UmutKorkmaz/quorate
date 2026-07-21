// SPDX-License-Identifier: Apache-2.0
//
// Models.swift — Codable mirrors of the monitor SSE payload.
//
// Field names match the Node server's monitorSnapshotPayload EXACTLY. Decoding
// is LENIENT: one malformed run must not invalidate the whole frame, so each
// top-level optional is decoded defensively and arrays are filtered for
// successful decodes rather than failing the snapshot.

import Foundation

struct Snapshot: Codable {
    let runs: [Run]
    let approvals: [Approval]?
    let external: [ExternalProc]?
    let stats: Stats?

    init(runs: [Run], approvals: [Approval]?, external: [ExternalProc]?, stats: Stats?) {
        self.runs = runs
        self.approvals = approvals
        self.external = external
        self.stats = stats
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Lenient: a bad runs array yields an empty list, not a decode error.
        runs = (try? c.decode([Run].self, forKey: .runs)) ?? []
        approvals = try? c.decodeIfPresent([Approval].self, forKey: .approvals)
        external = try? c.decodeIfPresent([ExternalProc].self, forKey: .external)
        stats = try? c.decodeIfPresent(Stats.self, forKey: .stats)
    }
}

struct Run: Codable, Identifiable {
    let runId: String
    let repo: String
    let mode: String
    let subject: String
    let status: String
    let startedAt: String
    let verdict: String?
    let degraded: Bool?
    let parentLane: String?
    let source: String?
    let kind: String?
    let lanes: [Lane]
    let children: [Run]?

    var id: String { runId }
    var isExternal: Bool { kind == "external" }

    init(runId: String, repo: String, mode: String, subject: String, status: String, startedAt: String, verdict: String? = nil, degraded: Bool? = nil, parentLane: String? = nil, source: String? = nil, kind: String? = nil, lanes: [Lane], children: [Run]? = nil) {
        self.runId = runId
        self.repo = repo
        self.mode = mode
        self.subject = subject
        self.status = status
        self.startedAt = startedAt
        self.verdict = verdict
        self.degraded = degraded
        self.parentLane = parentLane
        self.source = source
        self.kind = kind
        self.lanes = lanes
        self.children = children
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        runId = (try? c.decode(String.self, forKey: .runId)) ?? "unknown"
        repo = (try? c.decode(String.self, forKey: .repo)) ?? ""
        mode = (try? c.decode(String.self, forKey: .mode)) ?? ""
        subject = (try? c.decode(String.self, forKey: .subject)) ?? ""
        status = (try? c.decode(String.self, forKey: .status)) ?? "unknown"
        startedAt = (try? c.decode(String.self, forKey: .startedAt)) ?? ""
        verdict = try? c.decodeIfPresent(String.self, forKey: .verdict)
        degraded = try? c.decodeIfPresent(Bool.self, forKey: .degraded)
        parentLane = try? c.decodeIfPresent(String.self, forKey: .parentLane)
        source = try? c.decodeIfPresent(String.self, forKey: .source)
        kind = try? c.decodeIfPresent(String.self, forKey: .kind)
        lanes = (try? c.decode([Lane].self, forKey: .lanes)) ?? []
        children = try? c.decodeIfPresent([Run].self, forKey: .children)
    }
}

struct Lane: Codable, Identifiable {
    let laneKey: String
    let providerId: String
    let role: String
    let gate: Bool?
    let state: String
    let note: String?
    let status: String?
    let preview: String?
    let error: String?
    let tail: [String]?

    var id: String { laneKey }
}

struct Approval: Codable, Identifiable {
    let id: String
    let runId: String
    let source: String?
    let toolName: String
    let summary: String
    let createdAt: String
    let expiresAt: String
}

struct ExternalProc: Codable, Identifiable {
    let pid: Int
    let name: String
    let etime: String?
    let command: String?

    var id: Int { pid }
}

struct Stats: Codable {
    let today: TodayStats?
}

struct TodayStats: Codable {
    let runs: Int?
    let bySource: [String: Int]?
}

extension Snapshot {
    static let empty = Snapshot(runs: [], approvals: nil, external: nil, stats: nil)
}
