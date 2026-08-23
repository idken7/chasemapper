import Foundation

// MARK: - Error Response

struct ErrorDTO: Codable, Equatable {
    let error: String
    let retryAfterS: Int?

    enum CodingKeys: String, CodingKey {
        case error
        case retryAfterS = "retry_after_s"
    }
}

// MARK: - GeoJSON Models

struct GeoJSONFeature: Codable, Equatable {
    let type: String
    let geometry: GeoJSONGeometry
    let properties: [String: JSONValue]?

    enum CodingKeys: String, CodingKey {
        case type, geometry, properties
    }
}

struct GeoJSONGeometry: Codable, Equatable {
    let type: String
    let coordinates: [[Double]]

    enum CodingKeys: String, CodingKey {
        case type, coordinates
    }
}

// MARK: - Extensible JSON Value Type

enum JSONValue: Codable, Equatable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case array([JSONValue])
    case object([String: JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Int.self) {
            self = .int(value)
        } else if let value = try? container.decode(Double.self) {
            self = .double(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null:
            try container.encodeNil()
        case .bool(let value):
            try container.encode(value)
        case .int(let value):
            try container.encode(value)
        case .double(let value):
            try container.encode(value)
        case .string(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        }
    }
}

// MARK: - Route Request/Response DTOs

struct RouteRequestDTO: Codable, Equatable {
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
}

struct RouteResponseDTO: Codable, Equatable {
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
}

// MARK: - Car State DTO

struct CarDTO: Codable, Equatable {
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

// MARK: - Target State DTOs

struct TargetDTO: Codable, Equatable {
    let callsign: String
    let landing: LandingDTO
    let telemetry: TargetTelemetryDTO?
    let timeToLanding: String?
    let timeToLandingS: Int?

    enum CodingKeys: String, CodingKey {
        case callsign, landing, telemetry
        case timeToLanding = "time_to_landing"
        case timeToLandingS = "time_to_landing_s"
    }
}

/// Live payload position, as reported in `target.telemetry` (`position` is `[lat, lon, alt]`).
struct TargetTelemetryDTO: Codable, Equatable {
    let position: [Double]?
    let speed: Double?
    let velV: Double?

    enum CodingKeys: String, CodingKey {
        case position, speed
        case velV = "vel_v"
    }

    var lat: Double? { position != nil && position!.count > 0 ? position![0] : nil }
    var lon: Double? { position != nil && position!.count > 1 ? position![1] : nil }
    var alt: Double? { position != nil && position!.count > 2 ? position![2] : nil }
}

struct LandingDTO: Codable, Equatable {
    let lat: Double?
    let lon: Double?
    let alt: Double?

    enum CodingKeys: String, CodingKey {
        case lat, lon, alt
    }
}

// MARK: - Route State DTO

struct RouteDTO: Codable, Equatable {
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

struct GeoJSONMinimalDTO: Codable, Equatable {
    let type: String?
    let geometry: GeoJSONGeometryDTO?

    enum CodingKeys: String, CodingKey {
        case type, geometry
    }
}

struct GeoJSONGeometryDTO: Codable, Equatable {
    let type: String?
    let coordinates: [[Double]]?

    enum CodingKeys: String, CodingKey {
        case type, coordinates
    }
}

// MARK: - ETA DTO

struct EtaDTO: Codable, Equatable {
    let routeDurationS: Double?
    let payloadTimeToLandingS: Int?
    let payloadTimeToLanding: String?

    enum CodingKeys: String, CodingKey {
        case routeDurationS = "route_duration_s"
        case payloadTimeToLandingS = "payload_time_to_landing_s"
        case payloadTimeToLanding = "payload_time_to_landing"
    }
}
