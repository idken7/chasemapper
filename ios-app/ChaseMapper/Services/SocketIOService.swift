import Foundation

// MARK: - Socket.IO Connection State
enum SocketIOConnectionState {
    case disconnected
    case connecting
    case connected
    case reconnecting(attempt: Int)
    case failed(error: Error)
}

// MARK: - Socket.IO Service (Stub)
@MainActor
final class SocketIOService: NSObject, ObservableObject {
    static let shared = SocketIOService()
    
    @Published var connectionState: SocketIOConnectionState = .disconnected
    @Published var isConnected: Bool = false
    @Published var lastTelemetryEvent: TelemetryEvent?
    
    private var serverURL: URL
    private let namespace: String = "/chasemapper"

    init(serverURL: URL = ServerConfig.defaultBaseURL()) {
        self.serverURL = serverURL
        super.init()
    }

    /// Update the server URL at runtime (e.g. after the user edits it in Settings).
    func updateServerURL(_ url: URL) {
        self.serverURL = url
    }

    func connect() {
        connectionState = .connecting
        isConnected = true
    }
    
    func disconnect() {
        connectionState = .disconnected
        isConnected = false
    }
    
    func reconnect() {
        connect()
    }
}

// MARK: - Socket.IO Connection State Extension
extension SocketIOConnectionState {
    var displayName: String {
        switch self {
        case .disconnected:
            return "Disconnected"
        case .connecting:
            return "Connecting..."
        case .connected:
            return "Connected"
        case .reconnecting(let attempt):
            return "Reconnecting (attempt \(attempt))..."
        case .failed(let error):
            return "Failed: \(error.localizedDescription)"
        }
    }
}
