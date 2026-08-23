import Foundation
import CoreLocation

// MARK: - Route Request Models

/// Request body for POST /api/route endpoint.
/// Initiates route calculation between start and end coordinates.
struct RouteRequest: Codable, Equatable {
    let startLat: Double
    let startLon: Double
    let endLat: Double
    let endLon: Double

    enum CodingKeys: String, CodingKey {
        case startLat = "start_lat"
        case startLon = "start_lon"
        case endLat = "end_lat"
        case endLon = "end_lon"
    }

    init(startLat: Double, startLon: Double, endLat: Double, endLon: Double) {
        self.startLat = startLat
        self.startLon = startLon
        self.endLat = endLat
        self.endLon = endLon
    }

    init(from start: CLLocationCoordinate2D, to end: CLLocationCoordinate2D) {
        self.startLat = start.latitude
        self.startLon = start.longitude
        self.endLat = end.latitude
        self.endLon = end.longitude
    }
}

// MARK: - Route Response Models

/// Response from POST /api/route endpoint.
/// Contains GeoJSON route geometry and metadata.
struct RouteResponse: Codable, Equatable {
    let feature: GeoJSONFeature
    let distanceM: Double
    let durationS: Double
    let provider: String
    let providerBase: String

    enum CodingKeys: String, CodingKey {
        case feature
        case distanceM = "distance_m"
        case durationS = "duration_s"
        case provider
        case providerBase = "provider_base"
    }

    var coordinates: [CLLocationCoordinate2D] {
        feature.geometry.coordinates.compactMap { pair in
            guard pair.count >= 2 else { return nil }
            return CLLocationCoordinate2D(latitude: pair[1], longitude: pair[0])
        }
    }
}

// MARK: - Route State

/// Latest route state from /api/mobile_state.
/// May be empty if no route is currently available.
struct RouteState: Codable, Equatable {
    let geojson: GeoJSONFeature?
    let distanceM: Double?
    let durationS: Double?
    let provider: String?
    let providerBase: String?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case geojson
        case distanceM = "distance_m"
        case durationS = "duration_s"
        case provider
        case providerBase = "provider_base"
        case updatedAt = "updated_at"
    }

    var coordinates: [CLLocationCoordinate2D] {
        guard let geojson = geojson else {
            return []
        }
        return geojson.geometry.coordinates.compactMap { pair in
            guard pair.count >= 2 else { return nil }
            return CLLocationCoordinate2D(latitude: pair[1], longitude: pair[0])
        }
    }

    var isEmpty: Bool {
        geojson == nil && distanceM == nil && durationS == nil
    }
}

// MARK: - Route Metadata

/// Provides quick access to route metadata and status.
struct RouteMetadata: Equatable {
    let distanceMeters: Double?
    let durationSeconds: Double?
    let provider: String?
    let lastUpdated: Date?
    let isReady: Bool

    init(from route: RouteState) {
        self.distanceMeters = route.distanceM
        self.durationSeconds = route.durationS
        self.provider = route.provider
        self.isReady = route.geojson != nil
        self.lastUpdated = route.updatedAt.flatMap { str in
            ISO8601DateFormatter().date(from: str)
        }
    }

    var formattedDistance: String {
        guard let meters = distanceMeters else { return "--" }
        if meters < 1000 {
            return String(format: "%.0f m", meters)
        }
        return String(format: "%.1f km", meters / 1000.0)
    }

    var formattedDuration: String {
        guard let seconds = durationSeconds else { return "--" }
        let total = Int(seconds.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        if hours > 0 {
            return String(format: "%d:%02d", hours, minutes)
        }
        return String(format: "%d min", minutes)
    }
}


