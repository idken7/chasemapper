import Foundation

// MARK: - Location Models
struct Location: Codable, Identifiable {
    let id: String
    let latitude: Double
    let longitude: Double
    let altitude: Double?
    let accuracy: Double?
    let timestamp: Date
    
    enum CodingKeys: String, CodingKey {
        case id
        case latitude = "lat"
        case longitude = "lon"
        case altitude = "alt"
        case accuracy = "acc"
        case timestamp = "ts"
    }
}

// MARK: - Chase Session Models
struct ChaseSession: Codable, Identifiable {
    let id: String
    let name: String
    let status: ChaseStatus
    let createdAt: Date
    let updatedAt: Date
    var locations: [Location] = []
    
    enum CodingKeys: String, CodingKey {
        case id
        case name
        case status
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case locations
    }
}

enum ChaseStatus: String, Codable {
    case active
    case paused
    case completed
    case cancelled
}

// MARK: - Payload Models
struct Payload: Codable, Identifiable {
    let id: String
    let callsign: String
    let latitude: Double
    let longitude: Double
    let altitude: Double?
    let speed: Double?
    let heading: Double?
    let timestamp: Date
    let source: String
    
    enum CodingKeys: String, CodingKey {
        case id
        case callsign
        case latitude = "lat"
        case longitude = "lon"
        case altitude = "alt"
        case speed
        case heading
        case timestamp = "ts"
        case source
    }
}

// MARK: - Server Response Models
struct ServerResponse<T: Codable>: Codable {
    let status: String
    let data: T?
    let error: String?
}

struct ChaseMapData: Codable {
    let sessions: [ChaseSession]
    let payloads: [Payload]
}
