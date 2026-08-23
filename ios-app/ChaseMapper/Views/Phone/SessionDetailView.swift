import SwiftUI

@available(iOS 16.0, *)
struct SessionDetailView: View {
    let session: ChaseSession
    @ObservedObject var viewModel: ChaseSessionViewModel
    
    var body: some View {
        List {
            Section("Session Info") {
                LabeledContent("Name", value: session.name)
                LabeledContent("Status", value: session.status.rawValue.capitalized)
                LabeledContent("Locations", value: "\(session.locations.count)")
                LabeledContent(
                    "Created",
                    value: session.createdAt.formatted(date: .abbreviated, time: .shortened)
                )
            }
            
            if !session.locations.isEmpty {
                Section("Location History") {
                    ForEach(session.locations) { location in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(formatTime(location.timestamp))
                                .font(.caption)
                                .foregroundColor(.secondary)
                            
                            Text("↵ \(String(format: "%.4f", location.latitude)), \(String(format: "%.4f", location.longitude))")
                                .font(.caption)
                        }
                    }
                }
            }
            
            Section("Actions") {
                if session.status == .active {
                    Button(action: { viewModel.updateSessionStatus(session, status: .paused) }) {
                        Label("Pause Session", systemImage: "pause.fill")
                            .foregroundColor(.orange)
                    }
                }
                
                if session.status == .paused {
                    Button(action: { viewModel.updateSessionStatus(session, status: .active) }) {
                        Label("Resume Session", systemImage: "play.fill")
                            .foregroundColor(.blue)
                    }
                }
                
                if session.status != .completed {
                    Button(action: { viewModel.updateSessionStatus(session, status: .completed) }) {
                        Label("Complete Session", systemImage: "checkmark.circle.fill")
                            .foregroundColor(.green)
                    }
                }
            }
        }
    }
    
    private func formatTime(_ date: Date) -> String {
        let formatter = Foundation.DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

@available(iOS 16.0, *)
#Preview {
    NavigationView {
        SessionDetailView(
            session: ChaseSession(
                id: "test",
                name: "Test Session",
                status: .active,
                createdAt: Date(),
                updatedAt: Date(),
                locations: []
            ),
            viewModel: ChaseSessionViewModel()
        )
    }
}
