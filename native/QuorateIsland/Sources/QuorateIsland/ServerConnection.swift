// SPDX-License-Identifier: Apache-2.0
//
// ServerConnection.swift — owns the SSE link to the monitor server.
//
// On start: read ~/.quorate/live/monitor.json. If absent or stale, spawn
// `quorate monitor --serve` (resolving the binary in ~/.local/bin,
// /usr/local/bin, /opt/homebrew/bin, then PATH), parse the one-line JSON it
// prints for url+token, and keep the child referenced. Then open an SSE stream
// against the URL, decoding `data: <snapshot>` lines. Reconnect with backoff
// (1s → 8s cap). Respawn the server at most once per minute if it dies.

import Combine
import Foundation

@MainActor
final class ServerConnection: ObservableObject {
    @Published private(set) var snapshot: Snapshot = .empty
    @Published private(set) var connected: Bool = false
    @Published private(set) var serverOwnedByUs: Bool = false

    private var task: Task<Void, Never>?
    private var serverProcess: Process?
    private var lastSpawn: Date = .distantPast
    private var streamTask: Task<Void, Never>?

    private var liveDir: URL {
        URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".quorate/live")
    }
    private var discoveryURL: URL { liveDir.appendingPathComponent("monitor.json") }

    /// ISO8601 formatters. The Node side writes `new Date().toISOString()`
    /// (always fractional seconds); we try fractional first, then basic.
    private let iso8601Fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private let iso8601Basic: ISO8601DateFormatter = ISO8601DateFormatter()

    func start() {
        task?.cancel()
        task = Task { [weak self] in
            await self?.runForever()
        }
    }

    func stop() {
        task?.cancel()
        streamTask?.cancel()
        if let proc = serverProcess, proc.isRunning {
            proc.terminate()
        }
        serverProcess = nil
    }

    private func runForever() async {
        while !Task.isCancelled {
            do {
                let endpoint = try await resolveEndpoint()
                try await streamSnapshots(from: endpoint)
            } catch {
                connected = false
                // Backoff before reconnect/respawn.
                let delay = min(8.0, 1.0 + Double.random(in: 0...0.5))
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
        }
    }

    /// Returns the SSE url+token, spawning the server if no live discovery.
    private func resolveEndpoint() async throws -> (url: URL, token: String) {
        if let discovery = readDiscovery(), isFresh(discovery) {
            return (URL(string: discovery.url) ?? URL(string: "http://127.0.0.1/")!, discovery.token)
        }
        try await spawnServer()
        // Read again after giving it a moment.
        try await Task.sleep(nanoseconds: 1_500_000_000)
        // If we spawned a process but it never produced a discovery file, don't
        // leak it — terminate before the caller retries/respawns.
        guard let discovery = readDiscovery(), isFresh(discovery) else {
            if let proc = serverProcess, proc.isRunning {
                proc.terminate()
                serverProcess = nil
            }
            throw ServerError.noDiscovery
        }
        return (URL(string: discovery.url) ?? URL(string: "http://127.0.0.1/")!, discovery.token)
    }

    private struct Discovery: Decodable {
        let url: String
        let token: String
        let pid: Int
        let heartbeatAt: String
    }

    private func readDiscovery() -> Discovery? {
        guard FileManager.default.fileExists(atPath: discoveryURL.path) else { return nil }
        guard let data = try? Data(contentsOf: discoveryURL) else { return nil }
        return try? JSONDecoder().decode(Discovery.self, from: data)
    }

    /// Fresh = heartbeat within the last 6s AND the pid is alive.
    private func isFresh(_ d: Discovery) -> Bool {
        guard let hb = parseIso8601(d.heartbeatAt) else { return false }
        let age = Date().timeIntervalSince(hb)
        if age > 6 { return false }
        return kill(pid_t(d.pid), 0) == 0
    }

    /// Parse the ISO8601 string the Node side writes via `new Date().toISOString()`,
    /// which ALWAYS includes fractional seconds (e.g. `2026-07-20T22:00:00.123Z`).
    /// The default `ISO8601DateFormatter` (.withInternetDateTime) does NOT parse
    /// fractional seconds, so we configure `.withFractionalSeconds` and fall back
    /// to a non-fractional formatter for robustness.
    private func parseIso8601(_ string: String) -> Date? {
        if let date = iso8601Fractional.date(from: string) { return date }
        return iso8601Basic.date(from: string)
    }

    /// Spawn `quorate monitor --serve`, but at most once per minute.
    private func spawnServer() async throws {
        let now = Date()
        if now.timeIntervalSince(lastSpawn) < 60 { throw ServerError.tooSoonToRespawn }
        lastSpawn = now
        guard let binary = resolveQuorateBinary() else { throw ServerError.binaryNotFound }
        let proc = Process()
        proc.executableURL = binary
        proc.arguments = ["monitor", "--serve"]
        // Capture stdout to parse the one-line JSON; send stderr to /dev/null so
        // it cannot fill the OS pipe buffer (≈64KB) and deadlock the server.
        let stdoutPipe = Pipe()
        proc.standardOutput = stdoutPipe
        proc.standardError = FileHandle(forWritingAtPath: "/dev/null")
        do {
            try proc.run()
            serverProcess = proc
            serverOwnedByUs = true
        } catch {
            throw ServerError.spawnFailed(error.localizedDescription)
        }
        // Drain stdout asynchronously so the server can't block on a full pipe
        // while we wait for its first line. Discovery comes from monitor.json,
        // not this stdout — we just need to keep the buffer clear. The
        // readabilityHandler fires on data/EOF and is cleared on EOF.
        let handle = stdoutPipe.fileHandleForReading
        handle.readabilityHandler = { fh in
            let chunk = fh.availableData
            if chunk.isEmpty {
                // EOF — stop draining.
                fh.readabilityHandler = nil
            }
            // Discard chunk; we only need to keep the pipe drained.
        }
    }

    private func resolveQuorateBinary() -> URL? {
        let candidates = [
            NSHomeDirectory() + "/.local/bin/quorate",
            "/usr/local/bin/quorate",
            "/opt/homebrew/bin/quorate"
        ]
        for path in candidates where FileManager.default.isExecutableFile(atPath: path) {
            return URL(fileURLWithPath: path)
        }
        // Fall back to PATH lookup via /usr/bin/env — returned as a best-effort.
        if let resolved = findOnPath("quorate") { return resolved }
        return nil
    }

    private func findOnPath(_ name: String) -> URL? {
        guard let path = ProcessInfo.processInfo.environment["PATH"] else { return nil }
        for dir in path.split(separator: ":") {
            let candidate = URL(fileURLWithPath: String(dir)).appendingPathComponent(name)
            if FileManager.default.isExecutableFile(atPath: candidate.path) {
                return candidate
            }
        }
        return nil
    }

    /// Stream `data: <json>` lines from the SSE endpoint.
    private func streamSnapshots(from endpoint: (url: URL, token: String)) async throws {
        guard var components = URLComponents(url: endpoint.url, resolvingAgainstBaseURL: false) else {
            throw ServerError.badUrl
        }
        let token = endpoint.token
        var items = components.queryItems ?? []
        items.append(URLQueryItem(name: "token", value: token))
        components.queryItems = items
        guard let eventsURL = components.url?.appendingPathComponent("events") else {
            throw ServerError.badUrl
        }
        // URLSession.bytes(for:) streams the body; SSE frames are `data: <json>\n\n`.
        let request = URLRequest(url: eventsURL)
        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            connected = false
            throw ServerError.badUrl
        }
        connected = true
        var dataBuffer = ""
        for try await line in bytes.lines {
            if Task.isCancelled { break }
            if line.hasPrefix("data: ") {
                dataBuffer = String(line.dropFirst("data: ".count))
            } else if line.isEmpty && !dataBuffer.isEmpty {
                await decodeAndPublish(dataBuffer)
                dataBuffer = ""
            }
        }
    }

    private func decodeAndPublish(_ json: String) async {
        guard let data = json.data(using: .utf8) else { return }
        let decoder = JSONDecoder()
        guard let snap = try? decoder.decode(Snapshot.self, from: data) else { return }
        snapshot = snap
    }

    enum ServerError: Error {
        case noDiscovery
        case tooSoonToRespawn
        case binaryNotFound
        case spawnFailed(String)
        case badUrl
    }
}
