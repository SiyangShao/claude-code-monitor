import Foundation
import SwiftUI

@Observable
final class SessionStore {
    var sessions: [MonitorSession] = []
    var isConnected: Bool = true

    private var pollingTask: Task<Void, Never>?
    private let settings: AppSettings

    init(settings: AppSettings) {
        self.settings = settings
    }

    // MARK: - Computed

    var worstStatus: SessionStatus {
        guard !sessions.isEmpty else { return .idle }
        return sessions.min(by: { $0.status.priority < $1.status.priority })?.status ?? .idle
    }

    /// Sessions grouped by machine name, sorted
    var groupedSessions: [(machine: String, sessions: [MonitorSession])] {
        let grouped = Dictionary(grouping: sessions, by: \.machine)
        return grouped.keys.sorted().map { key in
            (machine: key, sessions: grouped[key]!)
        }
    }

    /// Status counts for summary
    var statusCounts: [SessionStatus: Int] {
        var counts: [SessionStatus: Int] = [:]
        for s in sessions {
            counts[s.status, default: 0] += 1
        }
        return counts
    }

    var summaryText: String {
        let counts = statusCounts
        var parts: [String] = []
        if let c = counts[.active], c > 0 { parts.append("\(c) active") }
        if let c = counts[.waiting], c > 0 { parts.append("\(c) waiting") }
        if let c = counts[.compacting], c > 0 { parts.append("\(c) compacting") }
        if let c = counts[.idle], c > 0 { parts.append("\(c) idle") }
        return parts.isEmpty ? "No sessions" : parts.joined(separator: " · ")
    }

    // MARK: - Polling

    func startPolling() {
        stopPolling()
        pollingTask = Task { @MainActor in
            while !Task.isCancelled {
                await fetchSessions()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    func stopPolling() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    // MARK: - API Operations

    @MainActor
    func fetchSessions() async {
        do {
            let result = try await APIClient.fetchSessions(
                serverURL: settings.serverURL,
                apiKey: settings.apiKey
            )
            sessions = result
            isConnected = true
        } catch {
            isConnected = false
            print("[monitor] fetch failed: \(error)")
        }
    }

    @MainActor
    func hideSession(id: String) async {
        do {
            try await APIClient.hideSession(
                id: id,
                serverURL: settings.serverURL,
                apiKey: settings.apiKey
            )
            await fetchSessions()
        } catch {
            print("[monitor] hide failed: \(error)")
        }
    }

    @MainActor
    func renameSession(id: String, customTitle: String?) async {
        do {
            try await APIClient.renameSession(
                id: id,
                customTitle: customTitle,
                serverURL: settings.serverURL,
                apiKey: settings.apiKey
            )
            await fetchSessions()
        } catch {
            print("[monitor] rename failed: \(error)")
        }
    }

    @MainActor
    func restoreSession(id: String) async {
        do {
            try await APIClient.restoreSession(
                id: id,
                serverURL: settings.serverURL,
                apiKey: settings.apiKey
            )
            await fetchSessions()
        } catch {
            print("[monitor] restore failed: \(error)")
        }
    }
}
