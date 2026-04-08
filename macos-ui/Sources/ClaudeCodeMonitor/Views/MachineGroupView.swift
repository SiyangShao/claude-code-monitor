import SwiftUI

struct MachineGroupView: View {
    let machine: String
    let sessions: [MonitorSession]
    var store: SessionStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Machine header
            HStack(spacing: 4) {
                Text(machine.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                if let env = sessions.first?.environment {
                    Text("(\(env.rawValue))")
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .padding(.bottom, 4)

            ForEach(sessions) { session in
                SessionRowView(session: session, store: store)
            }
        }
    }
}
