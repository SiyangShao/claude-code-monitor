import SwiftUI

struct ContentView: View {
    var store: SessionStore
    var settings: AppSettings
    @State private var showSettings = false

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Claude Monitor")
                    .font(.system(size: 13, weight: .semibold))
                Spacer()
                Text(store.summaryText)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                Spacer()
                Button(action: { showSettings.toggle() }) {
                    Image(systemName: "gear")
                        .font(.system(size: 12))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            // Productivity bar
            if !store.sessions.isEmpty {
                ProductivityBar(statusCounts: store.statusCounts, total: store.sessions.count)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 6)
            }

            Divider()

            // Connection error
            if !store.isConnected {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                        .font(.system(size: 10))
                    Text("Cannot connect to server")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 6)
            }

            // Session list
            if store.sessions.isEmpty && store.isConnected {
                Spacer()
                VStack(spacing: 4) {
                    Text("No sessions")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                    Text("Waiting for agent reports...")
                        .font(.system(size: 11))
                        .foregroundStyle(.tertiary)
                }
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(store.groupedSessions.enumerated()), id: \.element.machine) { index, group in
                            if index > 0 {
                                Divider().padding(.horizontal, 12)
                            }
                            MachineGroupView(
                                machine: group.machine,
                                sessions: group.sessions,
                                store: store
                            )
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .frame(width: 320, height: 400)
        .background(.regularMaterial)
        .sheet(isPresented: $showSettings) {
            SettingsView(settings: settings, store: store)
        }
    }
}

// MARK: - Productivity Bar

struct ProductivityBar: View {
    let statusCounts: [SessionStatus: Int]
    let total: Int

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 1) {
                ForEach([SessionStatus.active, .waiting, .compacting, .idle], id: \.self) { status in
                    let count = statusCounts[status] ?? 0
                    if count > 0 {
                        let pct = CGFloat(count) / CGFloat(total)
                        RoundedRectangle(cornerRadius: 2)
                            .fill(colorForStatus(status))
                            .frame(width: max(4, pct * geo.size.width))
                            .help("\(count) \(status.label) (\(Int(pct * 100))%)")
                    }
                }
            }
        }
        .frame(height: 4)
        .clipShape(RoundedRectangle(cornerRadius: 2))
    }

    private func colorForStatus(_ status: SessionStatus) -> Color {
        switch status {
        case .active: return .green
        case .waiting: return .orange
        case .compacting: return .blue
        case .idle: return .gray
        }
    }
}
