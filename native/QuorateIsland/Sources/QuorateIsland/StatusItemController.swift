// SPDX-License-Identifier: Apache-2.0
//
// StatusItemController.swift — the menu-bar NSStatusItem.
//
// Variable title summarizes the snapshot: `◆3 ▸1 ⏳2` (total runs, running,
// approvals pending). ⏳ turns amber when approvals are waiting. Click toggles
// the panel.

import AppKit
import Combine

@MainActor
final class StatusItemController {
    private let statusItem: NSStatusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var cancellables = Set<AnyCancellable>()
    private let connection: ServerConnection
    private let settings: SettingsStore
    var onToggle: (() -> Void)?

    init(connection: ServerConnection, settings: SettingsStore) {
        self.connection = connection
        self.settings = settings
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "circle.grid.2x2", accessibilityDescription: "Quorate Island")
        }
    }

    func start() {
        statusItem.button?.target = self
        statusItem.button?.action = #selector(handleClick)
        connection.$snapshot
            .combineLatest(connection.$connected)
            .receive(on: RunLoop.main)
            .sink { [weak self] snapshot, connected in
                self?.render(snapshot: snapshot, connected: connected)
            }
            .store(in: &cancellables)
    }

    @objc private func handleClick() {
        onToggle?()
    }

    private func render(snapshot: Snapshot, connected: Bool) {
        guard let button = statusItem.button else { return }
        let total = snapshot.runs.count
        let running = snapshot.runs.filter { $0.status == "running" }.count
        let pending = snapshot.approvals?.count ?? 0
        var title = "◆\(total) ▸\(running)"
        if pending > 0 { title += " ⏳\(pending)" }
        if !connected { title = "—" }
        let attr = NSMutableAttributedString(string: title)
        let full = NSRange(location: 0, length: attr.length)
        attr.addAttribute(.font, value: NSFont.monospacedSystemFont(ofSize: 12, weight: .medium), range: full)
        if pending > 0 {
            attr.addAttribute(.foregroundColor, value: NSColor.systemOrange, range: full)
        } else {
            attr.addAttribute(.foregroundColor, value: NSColor.labelColor, range: full)
        }
        button.attributedTitle = attr
    }
}
