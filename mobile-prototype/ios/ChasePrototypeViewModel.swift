import Foundation
import CoreLocation
import SocketIO

struct TelemetrySnapshot: Equatable {
    var callsign: String
    var lat: Double
    var lon: Double
    var alt: Double?
    var speed: Double?
    var heading: Double?
    var timestamp: Date
}

final class ChasePrototypeViewModel: ObservableObject {
    @Published var latestTelemetry: TelemetrySnapshot?
    @Published var routeCoordinates: [CLLocationCoordinate2D] = []
    @Published var statusText: String = "Idle"

    // Update this for your deployment.
    private let baseURL = URL(string: "http://127.0.0.1:5001")!
    private let apiKey: String? = nil

    private var manager: SocketManager?
    private var socket: SocketIOClient?
    private var routePollTask: Task<Void, Never>?

    func start() {
        connectTelemetry()
        startRoutePolling()
    }

    func stop() {
        routePollTask?.cancel()
        routePollTask = nil

        socket?.disconnect()
        socket?.removeAllHandlers()
        socket = nil
        manager = nil
    }

    private func connectTelemetry() {
        let socketURL = baseURL
        let manager = SocketManager(
            socketURL: socketURL,
            config: [.log(false), .compress]
        )
        let socket = manager.socket(forNamespace: "/chasemapper")

        socket.on(clientEvent: .connect) { [weak self] _, _ in
            DispatchQueue.main.async {
                self?.statusText = "Telemetry connected"
            }
            socket.emit("client_connected", ["platform": "ios-prototype"])
        }

        socket.on(clientEvent: .error) { [weak self] data, _ in
            let msg = data.first.map { "\($0)" } ?? "socket error"
            DispatchQueue.main.async {
                self?.statusText = "Telemetry error: \(msg)"
            }
        }

        socket.on("telemetry_event") { [weak self] data, _ in
            guard let self,
                  let payload = data.first as? [String: Any],
                  let position = payload["position"] as? [Double],
                  position.count >= 2 else {
                return
            }

            let callsign = (payload["callsign"] as? String) ?? "UNKNOWN"
            let lat = position[0]
            let lon = position[1]
            let alt = position.count > 2 ? position[2] : nil
            let speed = payload["speed"] as? Double
            let heading = payload["heading"] as? Double

            let snapshot = TelemetrySnapshot(
                callsign: callsign,
                lat: lat,
                lon: lon,
                alt: alt,
                speed: speed,
                heading: heading,
                timestamp: Date()
            )

            DispatchQueue.main.async {
                self.latestTelemetry = snapshot
            }
        }

        self.manager = manager
        self.socket = socket
        socket.connect()
    }

    private func startRoutePolling() {
        routePollTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                await self.fetchLatestRoute()
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    @MainActor
    private func setStatus(_ text: String) {
        statusText = text
    }

    private func fetchLatestRoute() async {
        var request = URLRequest(url: baseURL.appending(path: "api/latest_route"))
        request.httpMethod = "GET"
        request.timeoutInterval = 3.0
        if let apiKey, !apiKey.isEmpty {
            request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                await setStatus("Route fetch failed: invalid response")
                return
            }

            if http.statusCode == 404 {
                await setStatus("No route yet")
                return
            }
            if http.statusCode != 200 {
                await setStatus("Route fetch failed: \(http.statusCode)")
                return
            }

            let decoder = JSONDecoder()
            let feature = try decoder.decode(GeoJSONFeature.self, from: data)
            guard feature.geometry.type == "LineString" else {
                await setStatus("Route geometry not LineString")
                return
            }

            let coords = feature.geometry.coordinates.map {
                CLLocationCoordinate2D(latitude: $0[1], longitude: $0[0])
            }

            await MainActor.run {
                self.routeCoordinates = coords
                if self.statusText.hasPrefix("Route fetch failed") || self.statusText == "No route yet" || self.statusText == "Idle" {
                    self.statusText = "Route loaded"
                }
            }
        } catch {
            await setStatus("Route fetch error: \(error.localizedDescription)")
        }
    }
}

private struct GeoJSONFeature: Decodable {
    let type: String
    let geometry: GeoJSONGeometry
}

private struct GeoJSONGeometry: Decodable {
    let type: String
    let coordinates: [[Double]]
}
