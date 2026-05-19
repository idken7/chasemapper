import Foundation

// Shared DTOs for mapping /api/mobile_state into platform UI states.
struct MobileStateDTO: Decodable {
    let serverTime: String
    let car: CarDTO?
    let target: TargetDTO?
    let route: RouteDTO
    let eta: EtaDTO

    enum CodingKeys: String, CodingKey {
        case serverTime = "server_time"
        case car, target, route, eta
    }
}

struct CarDTO: Decodable {
    let lat: Double?
    let lon: Double?
    let alt: Double?
    let speed: Double?
    let heading: Double?
    let headingValid: Bool?
    let lastUpdate: String?

    enum CodingKeys: String, CodingKey {
        case lat, lon, alt, speed, heading
        case headingValid = "heading_valid"
        case lastUpdate = "last_update"
    }
}

struct TargetDTO: Decodable {
    let callsign: String
    let landing: LandingDTO
    let timeToLanding: String?
    let timeToLandingS: Int?

    enum CodingKeys: String, CodingKey {
        case callsign, landing
        case timeToLanding = "time_to_landing"
        case timeToLandingS = "time_to_landing_s"
    }
}

struct LandingDTO: Decodable {
    let lat: Double?
    let lon: Double?
    let alt: Double?
}

struct RouteDTO: Decodable {
    let geojson: GeoJSONMinimalDTO?
    let distanceM: Double?
    let durationS: Double?
    let provider: String?
    let providerBase: String?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case geojson, provider
        case distanceM = "distance_m"
        case durationS = "duration_s"
        case providerBase = "provider_base"
        case updatedAt = "updated_at"
    }
}

struct GeoJSONMinimalDTO: Decodable {
    let type: String?
    let geometry: GeoJSONGeometryDTO?
}

struct GeoJSONGeometryDTO: Decodable {
    let type: String?
    let coordinates: [[Double]]?
}

struct EtaDTO: Decodable {
    let routeDurationS: Double?
    let payloadTimeToLandingS: Int?
    let payloadTimeToLanding: String?

    enum CodingKeys: String, CodingKey {
        case routeDurationS = "route_duration_s"
        case payloadTimeToLandingS = "payload_time_to_landing_s"
        case payloadTimeToLanding = "payload_time_to_landing"
    }
}

