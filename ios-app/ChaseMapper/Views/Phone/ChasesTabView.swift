import SwiftUI

@available(iOS 16.0, *)
struct ChasesTabView: View {
    @ObservedObject var viewModel: ChaseSessionViewModel
    @State private var showNewSessionSheet = false
    @State private var newSessionName = ""
    
    var body: some View {
        List {
            ForEach(viewModel.sessions) { session in
                NavigationLink(destination: SessionDetailView(session: session, viewModel: viewModel)) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(session.name)
                            .font(.headline)
                        
                        HStack {
                            Label(session.status.rawValue.capitalized, systemImage: statusIcon(session.status))
                                .font(.caption)
                                .foregroundColor(.secondary)
                            
                            Spacer()
                            
                            Text("\(session.locations.count) locations")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: { showNewSessionSheet = true }) {
                    Image(systemName: "plus.circle.fill")
                }
            }
        }
        .sheet(isPresented: $showNewSessionSheet) {
            NewSessionSheet(
                isPresented: $showNewSessionSheet,
                sessionName: $newSessionName,
                onCreate: {
                    viewModel.createSession(name: newSessionName)
                    newSessionName = ""
                }
            )
        }
        .onAppear {
            if viewModel.sessions.isEmpty {
                viewModel.fetchSessions()
            }
        }
    }
    
    private func statusIcon(_ status: ChaseStatus) -> String {
        switch status {
        case .active:
            return "play.circle.fill"
        case .paused:
            return "pause.circle.fill"
        case .completed:
            return "checkmark.circle.fill"
        case .cancelled:
            return "xmark.circle.fill"
        }
    }
}

@available(iOS 16.0, *)
struct NewSessionSheet: View {
    @Binding var isPresented: Bool
    @Binding var sessionName: String
    var onCreate: () -> Void
    
    var body: some View {
        Form {
            TextField("Session Name", text: $sessionName)
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Cancel") {
                    isPresented = false
                }
            }
            
            ToolbarItem(placement: .topBarTrailing) {
                Button("Create") {
                    onCreate()
                    isPresented = false
                }
            }
        }
    }
}

@available(iOS 16.0, *)
#Preview {
    ChasesTabView(viewModel: ChaseSessionViewModel())
}
