// SPDX-License-Identifier: Apache-2.0
//
// IslandPanel.swift — the floating non-activating panel.
//
// COMPACT PILL hugging the notch when safeAreaInsets.top > 0 (a real notch),
// else anchored just under the status item. EXPANDED card ~380x520 hosts the
// SwiftUI RunListView. Never steals focus (becomesKeyOnlyIfNeeded) and joins
// all Spaces so it stays visible across them.

import AppKit
import SwiftUI

@MainActor
final class IslandPanelController {
    private var panel: NSPanel?
    private let connection: ServerConnection
    private let settings: SettingsStore
    private let sound: SoundPlayer

    init(connection: ServerConnection, settings: SettingsStore, sound: SoundPlayer) {
        self.connection = connection
        self.settings = settings
        self.sound = sound
    }

    func toggle() {
        if let panel, panel.isVisible {
            orderOut()
        } else {
            show()
        }
    }

    private func ensurePanel() -> NSPanel {
        if let panel { return panel }
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 380, height: 520),
            styleMask: [.nonactivatingPanel, .borderless, .titled, .resizable],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.standardWindowButton(.closeButton)?.isHidden = true
        panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
        panel.standardWindowButton(.zoomButton)?.isHidden = true
        let view = RunListView()
            .environmentObject(connection)
            .environmentObject(settings)
        panel.contentView = NSHostingView(rootView: view)
        self.panel = panel
        return panel
    }

    private func show() {
        let panel = ensurePanel()
        position(panel)
        panel.alphaValue = 0
        orderFront(panel)
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.15
            panel.animator().alphaValue = 1
        }
    }

    private func orderOut() {
        guard let panel else { return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.12
            panel.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            // completionHandler is non-isolated; hop back to MainActor.
            Task { @MainActor [weak self] in
                self?.panel?.orderOut(nil)
            }
        })
    }

    private func orderFront(_ panel: NSPanel) {
        panel.orderFrontRegardless()
    }

    /// Position the panel under the status item (or under the notch on newer Macs).
    private func position(_ panel: NSPanel) {
        guard let screen = NSScreen.main else { return }
        let frame = panel.frame
        // Anchor horizontally near the menu-bar item; vertically below the bar.
        let topInset = screen.safeAreaInsets.top
        let menubarHeight = topInset > 0 ? max(topInset, 24) : NSApp.mainMenu?.menuBarHeight ?? 24
        let visibleFrame = screen.visibleFrame
        let x = visibleFrame.maxX - frame.width - 12
        let y = visibleFrame.maxY - menubarHeight - frame.height - 6
        panel.setFrameOrigin(NSPoint(x: x, y: y))
    }
}
