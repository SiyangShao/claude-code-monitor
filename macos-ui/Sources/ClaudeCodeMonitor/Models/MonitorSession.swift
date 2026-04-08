import Foundation

enum SessionStatus: String, Codable, CaseIterable {
    case active
    case waiting
    case compacting
    case idle

    /// Priority for "worst status" calculation (lower = worse)
    var priority: Int {
        switch self {
        case .waiting: return 0
        case .active: return 1
        case .compacting: return 2
        case .idle: return 3
        }
    }

    var emoji: String {
        switch self {
        case .active: return "⚡"
        case .waiting: return "⏳"
        case .compacting: return "🧹"
        case .idle: return "💤"
        }
    }

    var label: String {
        rawValue
    }
}

enum EnvironmentType: String, Codable {
    case local
    case ssh
    case docker
}

struct MonitorSession: Codable, Identifiable, Hashable {
    var id: String { sessionId }

    let sessionId: String
    let status: SessionStatus
    let cwd: String
    let title: String?
    let slug: String?
    let customTitle: String?
    let lastActivity: String
    let machine: String
    let environment: EnvironmentType
    let pid: Int?
    let claudeVersion: String?
    let hidden: Bool
    let hiddenAt: String?
    let firstSeen: String
    let lastReported: String?

    /// Display name with fallback chain
    var displayName: String {
        if let t = customTitle, !t.isEmpty { return t }
        if let t = title, !t.isEmpty { return t }
        if let s = slug, !s.isEmpty { return s }
        let short = shortPath
        if !short.isEmpty { return short }
        return String(sessionId.prefix(8))
    }

    /// Last 2 path segments of cwd
    var shortPath: String {
        let parts = cwd.split(separator: "/").map(String.init)
        if parts.count <= 2 { return cwd }
        return parts.suffix(2).joined(separator: "/")
    }

    /// Relative time string from ISO 8601 date
    var lastActivityAgo: String {
        Self.formatTimeAgo(isoString: lastActivity)
    }

    var firstSeenAgo: String {
        Self.formatTimeAgo(isoString: firstSeen)
    }

    static func formatTimeAgo(isoString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: isoString) ?? ISO8601DateFormatter().date(from: isoString) else {
            return "?"
        }
        let diff = Int(Date().timeIntervalSince(date))
        if diff < 60 { return "\(diff)s" }
        let minutes = diff / 60
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h" }
        let days = hours / 24
        return "\(days)d"
    }
}

struct SessionsResponse: Codable {
    let sessions: [MonitorSession]
}
