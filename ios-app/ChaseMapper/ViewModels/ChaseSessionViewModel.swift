import SwiftUI

@MainActor
class ChaseSessionViewModel: ObservableObject {
    @Published var sessions: [ChaseSession] = []
    @Published var activeSession: ChaseSession?
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private let apiService = APIService.shared
    
    func fetchSessions() {
        isLoading = true
        Task {
            do {
                let sessions = try await apiService.fetchSessions()
                self.sessions = sessions
                self.activeSession = sessions.first(where: { $0.status == .active })
                errorMessage = nil
            } catch {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }
    
    func createSession(name: String) {
        Task {
            do {
                let session = try await apiService.createSession(name: name)
                self.sessions.append(session)
                self.activeSession = session
                errorMessage = nil
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
    
    func updateSessionStatus(_ session: ChaseSession, status: ChaseStatus) {
        Task {
            do {
                let updated = try await apiService.updateSessionStatus(
                    sessionId: session.id,
                    status: status
                )
                if let index = sessions.firstIndex(where: { $0.id == session.id }) {
                    sessions[index] = updated
                    if activeSession?.id == session.id {
                        activeSession = updated
                    }
                }
                errorMessage = nil
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
