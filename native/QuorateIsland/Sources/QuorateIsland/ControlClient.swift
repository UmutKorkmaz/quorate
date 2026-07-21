// SPDX-License-Identifier: Apache-2.0
//
// ControlClient.swift — POST /control for approve/deny/jump/abort/rerun.
//
// Reads the discovery file for url+token so the app never hardcodes endpoints.
// All requests are fire-and-forget; the next SSE frame reflects the result.

import Foundation

@MainActor
final class ControlClient {
    private var liveDir: URL {
        URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".quorate/live")
    }
    private var discoveryURL: URL { liveDir.appendingPathComponent("monitor.json") }

    struct Discovery: Decodable {
        let url: String
        let token: String
    }

    private func currentEndpoint() -> (url: URL, token: String)? {
        guard let data = try? Data(contentsOf: discoveryURL),
              let d = try? JSONDecoder().decode(Discovery.self, from: data),
              let url = URL(string: d.url) else { return nil }
        return (url, d.token)
    }

    func send(_ action: String, runId: String? = nil, id: String? = nil, reason: String? = nil) async {
        guard let endpoint = currentEndpoint() else { return }
        guard var components = URLComponents(url: endpoint.url, resolvingAgainstBaseURL: false) else { return }
        var items = components.queryItems ?? []
        items.append(URLQueryItem(name: "token", value: endpoint.token))
        components.queryItems = items
        guard let base = components.url?.appendingPathComponent("control") else { return }

        var body: [String: String] = ["action": action]
        if let runId { body["runId"] = runId }
        if let id { body["id"] = id }
        if let reason { body["reason"] = reason }

        var request = URLRequest(url: base)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.timeoutInterval = 10
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        _ = try? await URLSession.shared.data(for: request)
    }
}
