import Foundation
import CoreLocation

// MARK: - Common

public struct ApiErrorResponse: Codable {
    public let error: String
    public let retryAfterS: Int?

    enum CodingKeys: String, CodingKey {
        case error
        case retryAfterS = "retry_after_s"
    }
}

public typealias LonLat = [Double]

// MARK: - /api/route (POST)

public struct RouteRequest: Codable {
    public let startLat: Double
    public let startLon: Double
    public let endLat: Double
    public let endLon: Double

    enum CodingKeys: String, CodingKey {
        case startLat = "start_lat"
        case startLon = "start_lon"
        case endLat = "end_lat"
        case endLon = "end_lon"
    }

    public init(startLat: Double, startLon: Double, endLat: Double, endLon: Double) {
        self.startLat = startLat
        self.startLon = startLon
        self.endLat = endLat
        self.endLon = endLon
    }
}

public struct RouteResponse: Codable {
    public let feature: GeoJSONFeature
    public let distanceM: Double
    public let durationS: Double
    public let provider: String
    public let providerBase: String

    enum CodingKeys: String, CodingKey {
        case feature
        case distanceM = "distance_m"
        case durationS = "duration_s"
        case provider
        case providerBase = "provider_base"
    }
}

// MARK: - /api/latest_route (GET)

public typealias LatestRouteResponse = GeoJSONFeature

// MARK: - /api/mobile_state (GET)

public struct MobileStateResponse: Codable {
    public let serverTime: String
    public let car: CarState?
    public let target: TargetState?
    public let route: RouteState
    public let eta: EtaState

    enum CodingKeys: String, CodingKey {
        case serverTime = "server_time"
        case car
        case target
        case route
        case eta
    }
}

public struct CarState: Codable {
    public let lat: Double?
    public let lon: Double?
    public let alt: Double?
    public let speed: Double?
    public let heading: Double?
    public let headingValid: Bool
    public let lastUpdate: String?

    enum CodingKeys: String, CodingKey {
        case lat
        case lon
        case alt
        case speed
        case heading
        case headingValid = "heading_valid"
        case lastUpdate = "last_update"
    }
}

public struct TargetState: Codable {
    public let callsign: String
    public let landing: LandingState
    public let telemetry: TelemetryState
    public let timeToLanding: String?
    public let timeToLandingS: Int?

    enum CodingKeys: String, CodingKey {
        case callsign
        case landing
        case telemetry
        case timeToLanding = "time_to_landing"
        case timeToLandingS = "time_to_landing_s"
    }
}

public struct LandingState: Codable {
    public let lat: Double?
    public let lon: Double?
    public let alt: Double?
}

public struct TelemetryState: Codable {
    public let callsign: String?
    public let position: [Double]?
    public let velV: Double?
    public let speed: Double?
    public let shortTime: String?
    public let packetTime: String?
    public let timeToLanding: String?
    public let serverTime: Double?
    public let heading: Double?

    enum CodingKeys: String, CodingKey {
        case callsign
        case position
        case velV = "vel_v"
        case speed
        case shortTime = "short_time"
        case packetTime = "packet_time"
        case timeToLanding = "time_to_landing"
        case serverTime = "server_time"
        case heading
    }
}

public struct RouteState: Codable {
    public let geojson: GeoJSONFeature?
    public let distanceM: Double?
    public let durationS: Double?
    public let provider: String?
    public let providerBase: String?
    public let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case geojson
        case distanceM = "distance_m"
        case durationS = "duration_s"
        case provider
        case providerBase = "provider_base"
        case updatedAt = "updated_at"
    }
}

public struct EtaState: Codable {
    public let routeDurationS: Double?
    public let payloadTimeToLandingS: Int?
    public let payloadTimeToLanding: String?

    enum CodingKeys: String, CodingKey {
        case routeDurationS = "route_duration_s"
        case payloadTimeToLandingS = "payload_time_to_landing_s"
        case payloadTimeToLanding = "payload_time_to_landing"
    }
}

// MARK: - GeoJSON (minimal contract shape)

public struct GeoJSONFeature: Codable {
    public let type: String
    public let geometry: GeoJSONGeometry
    public let properties: [String: JSONValue]?
}

public struct GeoJSONGeometry: Codable {
    public let type: String
    public let coordinates: [LonLat]

    public var polylineCoordinates: [CLLocationCoordinate2D] {
        coordinates.compactMap { pair in
            guard pair.count >= 2 else { return nil }
            return CLLocationCoordinate2D(latitude: pair[1], longitude: pair[0])
        }
    }
}

// MARK: - Any JSON dictionary values for extensible 'properties'

public enum JSONValue: Codable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case array([JSONValue])
    case object([String: JSONValue])
    case null

    public init(from decoder: Decoder) throws {
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

    public func encode(to encoder: Encoder) throws {
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
