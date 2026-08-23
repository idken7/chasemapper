import XCTest
@testable import ChaseMapper

final class ChaseMapperTests: XCTestCase {
    
    func testPayloadDecoding() throws {
        let json = """
        {
            "id": "test-payload",
            "callsign": "W5XYZ",
            "lat": 35.5,
            "lon": -98.5,
            "alt": 1000,
            "speed": 10,
            "heading": 45,
            "ts": "2024-01-01T12:00:00Z",
            "source": "aprs"
        }
        """
        
        let data = json.data(using: .utf8)!
        let decoder = JSONDecoder()
        let payload = try decoder.decode(Payload.self, from: data)
        
        XCTAssertEqual(payload.callsign, "W5XYZ")
        XCTAssertEqual(payload.latitude, 35.5)
        XCTAssertEqual(payload.longitude, -98.5)
    }
    
    func testChaseSessionDecoding() throws {
        let json = """
        {
            "id": "test-session",
            "name": "Test Chase",
            "status": "active",
            "created_at": "2024-01-01T12:00:00Z",
            "updated_at": "2024-01-01T12:00:00Z",
            "locations": []
        }
        """
        
        let data = json.data(using: .utf8)!
        let decoder = JSONDecoder()
        let session = try decoder.decode(ChaseSession.self, from: data)
        
        XCTAssertEqual(session.name, "Test Chase")
        XCTAssertEqual(session.status, .active)
    }
    
    func testLocationDecoding() throws {
        let json = """
        {
            "id": "test-location",
            "lat": 35.5,
            "lon": -98.5,
            "alt": 1000,
            "acc": 5,
            "ts": "2024-01-01T12:00:00Z"
        }
        """
        
        let data = json.data(using: .utf8)!
        let decoder = JSONDecoder()
        let location = try decoder.decode(Location.self, from: data)
        
        XCTAssertEqual(location.latitude, 35.5)
        XCTAssertEqual(location.longitude, -98.5)
    }
}
