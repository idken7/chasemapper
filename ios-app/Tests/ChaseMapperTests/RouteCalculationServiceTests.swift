import XCTest
import CoreLocation
@testable import ChaseMapper

final class RouteCalculationServiceTests: XCTestCase {
    var service: RouteCalculationService!
    var mockAPIService: MockAPIService!
    
    override func setUp() {
        super.setUp()
        mockAPIService = MockAPIService()
        service = RouteCalculationService(apiService: mockAPIService)
    }
    
    override func tearDown() {
        service.reset()
        super.tearDown()
    }
    
    // MARK: - shouldRecomputeRoute Tests
    
    func testShouldRecomputeRoute_NoRouteExists() {
        let target = CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060)
        let result = service.shouldRecomputeRoute(
            previousTarget: nil,
            newTarget: target,
            carPosition: nil
        )
        XCTAssertTrue(result, "Should recompute when no route exists")
    }
    
    func testShouldRecomputeRoute_DestinationMoved200m() {
        // Create two points ~200m apart
        let previous = CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060)
        let current = CLLocationCoordinate2D(latitude: 40.7143, longitude: -74.0060)
        let carPosition = CLLocationCoordinate2D(latitude: 40.7100, longitude: -74.0100)
        
        // First compute a route so one exists
        let mockRoute = RouteState(
            geojson: createMockGeoJSON(),
            distanceM: 5000,
            durationS: 600,
            provider: "test",
            providerBase: "test",
            updatedAt: ISO8601DateFormatter().string(from: Date())
        )
        service.lastComputedRoute = mockRoute
        
        let result = service.shouldRecomputeRoute(
            previousTarget: previous,
            newTarget: current,
            carPosition: carPosition
        )
        XCTAssertTrue(result, "Should recompute when destination moved >= 200m")
    }
    
    func testShouldRecomputeRoute_DestinationMovedLess200m() {
        // Create two points ~50m apart
        let previous = CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060)
        let current = CLLocationCoordinate2D(latitude: 40.7132, longitude: -74.0060)
        let carPosition = CLLocationCoordinate2D(latitude: 40.7100, longitude: -74.0100)
        
        // First compute a route so one exists
        let mockRoute = RouteState(
            geojson: createMockGeoJSON(),
            distanceM: 5000,
            durationS: 600,
            provider: "test",
            providerBase: "test",
            updatedAt: ISO8601DateFormatter().string(from: Date())
        )
        service.lastComputedRoute = mockRoute
        
        let result = service.shouldRecomputeRoute(
            previousTarget: previous,
            newTarget: current,
            carPosition: carPosition
        )
        XCTAssertFalse(result, "Should not recompute when destination moved < 200m")
    }
    
    func testShouldRecomputeRoute_CarDeviated60m() {
        let target = CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060)
        let carPosition = CLLocationCoordinate2D(latitude: 40.7200, longitude: -74.0060)
        
        // Create route with specific coordinates
        let routeCoords: [[Double]] = [
            [-74.0060, 40.7100],
            [-74.0060, 40.7128],
            [-74.0060, 40.7150]
        ]
        let geojson = GeoJSONFeature(
            type: "Feature",
            geometry: GeoJSONGeometry(type: "LineString", coordinates: routeCoords),
            properties: nil
        )
        
        let mockRoute = RouteState(
            geojson: geojson,
            distanceM: 5000,
            durationS: 600,
            provider: "test",
            providerBase: "test",
            updatedAt: ISO8601DateFormatter().string(from: Date())
        )
        service.lastComputedRoute = mockRoute
        
        let result = service.shouldRecomputeRoute(
            previousTarget: target,
            newTarget: target,
            carPosition: carPosition
        )
        XCTAssertTrue(result, "Should recompute when car deviated >= 60m from route")
    }
    
    // MARK: - distanceFromRoute Tests
    
    func testDistanceFromRoute_EmptyRoute() {
        let carPosition = CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060)
        let distance = service.distanceFromRoute(carPosition: carPosition, routeCoordinates: [])
        XCTAssertEqual(distance, .infinity, "Distance should be infinity for empty route")
    }
    
    func testDistanceFromRoute_SinglePoint() {
        let carPosition = CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060)
        let routePoint = CLLocationCoordinate2D(latitude: 40.7100, longitude: -74.0100)
        let distance = service.distanceFromRoute(
            carPosition: carPosition,
            routeCoordinates: [routePoint]
        )
        XCTAssertGreaterThan(distance, 0, "Distance should be positive")
    }
    
    func testDistanceFromRoute_MultipleSegments() {
        let carPosition = CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060)
        let routeCoords = [
            CLLocationCoordinate2D(latitude: 40.7100, longitude: -74.0100),
            CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060),
            CLLocationCoordinate2D(latitude: 40.7150, longitude: -74.0020)
        ]
        
        let distance = service.distanceFromRoute(
            carPosition: carPosition,
            routeCoordinates: routeCoords
        )
        // Car is very close to the second point, so distance should be small
        XCTAssertLessThan(distance, 100, "Distance should be small when car is near route")
    }
    
    // MARK: - formatRouteMetadata Tests
    
    func testFormatRouteMetadata_ValidValues() {
        let distance = 5000.0
        let duration = 600.0
        
        let (distStr, durStr, eta) = service.formatRouteMetadata(
            distance: distance,
            duration: duration
        )
        
        XCTAssertTrue(distStr.contains("5"), "Distance string should contain value")
        XCTAssertTrue(durStr.contains("10"), "Duration string should contain value")
        XCTAssertNotNil(eta, "ETA should not be nil")
    }
    
    func testFormatRouteMetadata_NilValues() {
        let (distStr, durStr, eta) = service.formatRouteMetadata(
            distance: nil,
            duration: nil
        )
        
        XCTAssertEqual(distStr, "--", "Distance string should be '--' for nil")
        XCTAssertEqual(durStr, "--", "Duration string should be '--' for nil")
        XCTAssertNil(eta, "ETA should be nil for nil duration")
    }
    
    func testFormatRouteMetadata_LargeDistance() {
        let distance = 50000.0
        let duration = 3600.0
        
        let (distStr, durStr, _) = service.formatRouteMetadata(
            distance: distance,
            duration: duration
        )
        
        XCTAssertTrue(distStr.contains("km"), "Large distance should be in km")
        XCTAssertTrue(durStr.contains(":"), "Large duration should have hour format")
    }
    
    // MARK: - Helper Methods
    
    private func createMockGeoJSON() -> GeoJSONFeature {
        let coordinates: [[Double]] = [
            [-74.0060, 40.7100],
            [-74.0060, 40.7128],
            [-74.0060, 40.7150]
        ]
        return GeoJSONFeature(
            type: "Feature",
            geometry: GeoJSONGeometry(type: "LineString", coordinates: coordinates),
            properties: nil
        )
    }
}

// MARK: - Mock APIService

class MockAPIService: APIService {
    var shouldFailRoute = false
    var computedRouteResponse: RouteResponseDTO?
    
    override func computeRoute(
        from start: CLLocationCoordinate2D,
        to end: CLLocationCoordinate2D
    ) async throws -> RouteResponseDTO {
        if shouldFailRoute {
            throw APIError.networkError("Mock network error")
        }
        
        if let response = computedRouteResponse {
            return response
        }
        
        let coordinates: [[Double]] = [
            [start.longitude, start.latitude],
            [end.longitude, end.latitude]
        ]
        
        return RouteResponseDTO(
            feature: GeoJSONFeature(
                type: "Feature",
                geometry: GeoJSONGeometry(type: "LineString", coordinates: coordinates),
                properties: nil
            ),
            distanceM: 5000,
            durationS: 600,
            provider: "test_provider",
            providerBase: "test_base"
        )
    }
}
