// SPDX-License-Identifier: Apache-2.0
//
// Main.swift — QuorateIsland entrypoint.
//
// A menu-bar/notch app that renders Quorate monitor's SSE feed. It owns no
// logic: the Node CLI is the source of truth (spool, controls, hooks); this
// app is a thin native renderer. NSApplication with .accessory activation
// policy keeps it out of the Dock — only the status item + panel are visible.

import AppKit
import SwiftUI

@main
struct QuorateIslandApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        // We drive everything from the AppDelegate (status item + panel). The
        // Scene body is intentionally empty — Settings scene below is a hook
        // for a future SwiftUI prefs window; today prefs live in the panel.
        Settings { EmptyView() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusController: StatusItemController?
    private var connection: ServerConnection?
    private var panelController: IslandPanelController?
    private var soundPlayer: SoundPlayer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let settings = SettingsStore.shared
        let player = SoundPlayer(settings: settings)
        let connection = ServerConnection()
        let status = StatusItemController(connection: connection, settings: settings)
        let panel = IslandPanelController(connection: connection, settings: settings, sound: player)
        self.connection = connection
        self.statusController = status
        self.panelController = panel
        self.soundPlayer = player
        status.onToggle = { [weak panel] in panel?.toggle() }
        status.start()
        player.attach(to: connection)
        connection.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        connection?.stop()
    }
}
