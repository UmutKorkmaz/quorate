// SPDX-License-Identifier: Apache-2.0
//
// Settings.swift — UserDefaults-backed preferences.
//
// soundsEnabled, notchPillEnabled, launchAtLogin. launchAtLogin uses
// SMAppService.mainApp (macOS 13+); can fail for an unsigned/ad-hoc-signed app,
// so registration is wrapped in try? and reported via a published flag.

import Foundation
import ServiceManagement
import Combine

@MainActor
final class SettingsStore: ObservableObject {
    static let shared = SettingsStore()

    @Published var soundsEnabled: Bool {
        didSet { UserDefaults.standard.set(soundsEnabled, forKey: "soundsEnabled") }
    }
    @Published var notchPillEnabled: Bool {
        didSet { UserDefaults.standard.set(notchPillEnabled, forKey: "notchPillEnabled") }
    }
    @Published var launchAtLogin: Bool {
        didSet {
            if launchAtLogin {
                launchAtLogin = (try? SMAppService.mainApp.register()) != nil
                if !launchAtLogin {
                    UserDefaults.standard.set(false, forKey: "launchAtLogin")
                }
            } else {
                try? SMAppService.mainApp.unregister()
                UserDefaults.standard.set(false, forKey: "launchAtLogin")
            }
        }
    }

    private init() {
        let defaults = UserDefaults.standard
        soundsEnabled = defaults.object(forKey: "soundsEnabled") as? Bool ?? true
        notchPillEnabled = defaults.object(forKey: "notchPillEnabled") as? Bool ?? true
        launchAtLogin = defaults.object(forKey: "launchAtLogin") as? Bool ?? false
    }
}
