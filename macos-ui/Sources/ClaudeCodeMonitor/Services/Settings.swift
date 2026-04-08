import Foundation

@Observable
final class AppSettings {
    var serverURL: String {
        didSet { UserDefaults.standard.set(serverURL, forKey: "serverURL") }
    }
    var apiKey: String {
        didSet { UserDefaults.standard.set(apiKey, forKey: "apiKey") }
    }

    init() {
        self.serverURL = UserDefaults.standard.string(forKey: "serverURL") ?? "http://localhost:19876"
        self.apiKey = UserDefaults.standard.string(forKey: "apiKey") ?? ""
    }
}
