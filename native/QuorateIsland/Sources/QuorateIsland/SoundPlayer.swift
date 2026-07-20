// SPDX-License-Identifier: Apache-2.0
//
// SoundPlayer.swift — NSSound cues, rate-limited.
//
// approval pending → Glass, run done pass → Purr, fail → Basso. Sounds are
// rate-limited (≥2s between any two) and gated by the soundsEnabled setting.

import AppKit
import Combine

@MainActor
final class SoundPlayer {
    private let settings: SettingsStore
    private var lastPlayed: Date = .distantPast
    private var cancellables = Set<AnyCancellable>()
    private var lastSnapshot: Snapshot = .empty

    init(settings: SettingsStore) {
        self.settings = settings
    }

    /// Attach to a connection to watch snapshot transitions for cue triggers.
    func attach(to connection: ServerConnection) {
        connection.$snapshot
            .receive(on: RunLoop.main)
            .sink { [weak self] snap in self?.handle(new: snap) }
            .store(in: &cancellables)
    }

    private func handle(new snap: Snapshot) {
        let now = Date()
        if now.timeIntervalSince(lastPlayed) < 2 { lastSnapshot = snap; return }
        // Approval appeared?
        let prevPending = lastSnapshot.approvals?.count ?? 0
        let nextPending = snap.approvals?.count ?? 0
        if nextPending > prevPending {
            play("Glass")
        } else {
            // A run transitioned to done with a verdict since last frame.
            let prevById = Dictionary(uniqueKeysWithValues: (lastSnapshot.runs).map { ($0.runId, $0) })
            for run in snap.runs where run.status == "done" {
                let prev = prevById[run.runId]
                if prev?.status != "done" {
                    switch run.verdict?.lowercased() {
                    case "pass": play("Purr")
                    case "fail": play("Basso")
                    default: break
                    }
                }
            }
        }
        lastSnapshot = snap
    }

    private func play(_ name: String) {
        guard settings.soundsEnabled else { return }
        NSSound(named: name)?.play()
        lastPlayed = Date()
    }
}
