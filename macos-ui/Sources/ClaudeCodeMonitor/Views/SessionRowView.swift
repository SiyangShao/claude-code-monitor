import SwiftUI
import AppKit

struct SessionRowView: View {
    let session: MonitorSession
    var store: SessionStore

    @State private var isRenaming = false
    @State private var renameText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                // Status emoji
                Text(session.status.emoji)
                    .font(.system(size: 14))
                    .frame(width: 20)

                // Session info
                VStack(alignment: .leading, spacing: 1) {
                    if isRenaming {
                        TextField("Session name", text: $renameText)
                            .textFieldStyle(.plain)
                            .font(.system(size: 12, weight: .medium))
                    } else {
                        Text(session.displayName)
                            .font(.system(size: 12, weight: .medium))
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    Text(session.shortPath)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }

                Spacer()

                if isRenaming {
                    // Save / Cancel buttons
                    HStack(spacing: 4) {
                        Button(action: { commitRename() }) {
                            Image(systemName: "checkmark")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(.green)
                        }
                        .buttonStyle(.plain)
                        .help("Save")

                        Button(action: { cancelRename() }) {
                            Image(systemName: "xmark")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .help("Cancel")
                    }
                } else {
                    // Time
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(session.lastActivityAgo)
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundStyle(.secondary)
                        Text(session.firstSeenAgo)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                    .help("Last activity / Created")
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 5)
        .contentShape(Rectangle())
        .background(backgroundForStatus)
        .contextMenu {
            Button("Copy Session ID") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(session.sessionId, forType: .string)
            }
            Button("Rename...") {
                startRename()
            }
            Divider()
            Button("Hide") {
                Task { await store.hideSession(id: session.sessionId) }
            }
        }
    }

    private var backgroundForStatus: some View {
        Group {
            switch session.status {
            case .active:
                Color.green.opacity(0.06)
            case .waiting:
                Color.orange.opacity(0.06)
            case .compacting:
                Color.blue.opacity(0.06)
            case .idle:
                Color.clear
            }
        }
    }

    private func startRename() {
        renameText = session.customTitle ?? session.displayName
        isRenaming = true
    }

    private func commitRename() {
        isRenaming = false
        let trimmed = renameText.trimmingCharacters(in: .whitespaces)
        let newTitle: String? = trimmed.isEmpty ? nil : trimmed
        Task { await store.renameSession(id: session.sessionId, customTitle: newTitle) }
    }

    private func cancelRename() {
        isRenaming = false
        renameText = ""
    }
}
