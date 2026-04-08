import SwiftUI

struct SettingsView: View {
    var settings: AppSettings
    var store: SessionStore
    @Environment(\.dismiss) private var dismiss

    @State private var serverURL: String = ""
    @State private var apiKey: String = ""
    @State private var testStatus: TestStatus = .none

    enum TestStatus {
        case none, testing, success(Int), error(String)
    }

    var body: some View {
        VStack(spacing: 16) {
            Text("Settings")
                .font(.headline)

            Form {
                TextField("Server URL:", text: $serverURL)
                    .textFieldStyle(.roundedBorder)
                SecureField("API Key (optional):", text: $apiKey)
                    .textFieldStyle(.roundedBorder)
            }
            .formStyle(.grouped)

            // Test connection
            HStack {
                Button("Test Connection") {
                    testConnection()
                }

                switch testStatus {
                case .none:
                    EmptyView()
                case .testing:
                    ProgressView()
                        .controlSize(.small)
                case .success(let count):
                    Label("\(count) sessions found", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .font(.system(size: 12))
                case .error(let msg):
                    Label(msg, systemImage: "xmark.circle.fill")
                        .foregroundStyle(.red)
                        .font(.system(size: 12))
                        .lineLimit(1)
                }
            }

            Spacer()

            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Save") { save() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 400, height: 280)
        .onAppear {
            serverURL = settings.serverURL
            apiKey = settings.apiKey
        }
    }

    private func testConnection() {
        testStatus = .testing
        let url = serverURL.hasSuffix("/") ? String(serverURL.dropLast()) : serverURL
        let key = apiKey
        Task {
            do {
                let sessions = try await APIClient.fetchSessions(serverURL: url, apiKey: key)
                testStatus = .success(sessions.count)
            } catch {
                testStatus = .error("Connection failed")
            }
        }
    }

    private func save() {
        settings.serverURL = serverURL.hasSuffix("/") ? String(serverURL.dropLast()) : serverURL
        settings.apiKey = apiKey
        // Restart polling with new settings
        store.stopPolling()
        store.startPolling()
        dismiss()
    }
}
