import Foundation

enum APIError: Error {
    case invalidURL
    case httpError(Int)
    case decodingError(Error)
}

struct APIClient {
    static func fetchSessions(serverURL: String, apiKey: String) async throws -> [MonitorSession] {
        let url = try buildURL(serverURL, path: "/api/sessions")
        print("[api] fetching \(url)")
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        addAuth(&request, apiKey: apiKey)

        let (data, response) = try await URLSession.shared.data(for: request)
        try checkResponse(response)

        do {
            let decoded = try JSONDecoder().decode(SessionsResponse.self, from: data)
            print("[api] got \(decoded.sessions.count) sessions")
            return decoded.sessions
        } catch {
            print("[api] decode error: \(error)")
            throw APIError.decodingError(error)
        }
    }

    static func hideSession(id: String, serverURL: String, apiKey: String) async throws {
        let url = try buildURL(serverURL, path: "/api/sessions/\(id)")
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        addAuth(&request, apiKey: apiKey)

        let (_, response) = try await URLSession.shared.data(for: request)
        try checkResponse(response)
    }

    static func renameSession(id: String, customTitle: String?, serverURL: String, apiKey: String) async throws {
        let url = try buildURL(serverURL, path: "/api/sessions/\(id)")
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addAuth(&request, apiKey: apiKey)
        request.httpBody = try JSONEncoder().encode(["customTitle": customTitle])

        let (_, response) = try await URLSession.shared.data(for: request)
        try checkResponse(response)
    }

    static func restoreSession(id: String, serverURL: String, apiKey: String) async throws {
        let url = try buildURL(serverURL, path: "/api/sessions/\(id)/restore")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        addAuth(&request, apiKey: apiKey)

        let (_, response) = try await URLSession.shared.data(for: request)
        try checkResponse(response)
    }

    // MARK: - Helpers

    private static func buildURL(_ base: String, path: String) throws -> URL {
        let trimmed = base.hasSuffix("/") ? String(base.dropLast()) : base
        guard let url = URL(string: trimmed + path) else {
            throw APIError.invalidURL
        }
        return url
    }

    private static func addAuth(_ request: inout URLRequest, apiKey: String) {
        if !apiKey.isEmpty {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }
    }

    private static func checkResponse(_ response: URLResponse) throws {
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw APIError.httpError(http.statusCode)
        }
    }
}
