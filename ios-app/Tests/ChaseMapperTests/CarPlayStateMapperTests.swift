import XCTest
import CoreLocation
@testable import ChaseMapper

final class CarPlayStateMapperTests: XCTestCase {
    var mapper: CarPlayStateMapper!

    override func setUp() {
        super.setUp()
        mapper = CarPlayStateMapper()
    }

    // MARK: - Tests: makeSnapshot with nil/empty state

    func testMakeSnapshot_withNilCarState() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: nil,
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.5, lon: -98.5, alt: 1000),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(
                geojson: nil,
                distanceM: nil,
                durationS: nil,
                provider: nil,
                providerBase: nil,
                updatedAt: nil
            ),
            eta: EtaDTO(
                routeDurationS: nil,
                payloadTimeToLandingS: 300,
                payloadTimeToLanding: nil
            )
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertNil(snapshot.carCoordinate, "Car coordinate should be nil when car state is nil")
        XCTAssertNotNil(snapshot.targetCoordinate, "Target coordinate should exist")
        XCTAssertEqual(snapshot.callsign, "W5XYZ")
    }

    func testMakeSnapshot_withNilTargetState() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: nil,
            route: RouteDTO(geojson: nil, distanceM: nil, durationS: nil, provider: nil, providerBase: nil, updatedAt: nil),
            eta: EtaDTO(routeDurationS: nil, payloadTimeToLandingS: nil, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertNotNil(snapshot.carCoordinate, "Car coordinate should exist")
        XCTAssertNil(snapshot.targetCoordinate, "Target coordinate should be nil when target state is nil")
        XCTAssertEqual(snapshot.callsign, "No target")
    }

    func testMakeSnapshot_withEmptyCallsign() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "   ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(geojson: nil, distanceM: nil, durationS: nil, provider: nil, providerBase: nil, updatedAt: nil),
            eta: EtaDTO(routeDurationS: nil, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertEqual(snapshot.callsign, "No target", "Whitespace-only callsign should be treated as empty")
    }

    func testMakeSnapshot_withInvalidCoordinates() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 91.0, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.5, lon: -181.0, alt: 1000),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(geojson: nil, distanceM: nil, durationS: nil, provider: nil, providerBase: nil, updatedAt: nil),
            eta: EtaDTO(routeDurationS: nil, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertNil(snapshot.carCoordinate, "Invalid car coordinate (lat > 90) should be nil")
        XCTAssertNil(snapshot.targetCoordinate, "Invalid target coordinate (lon > 180) should be nil")
    }

    // MARK: - Tests: Coordinate Extraction

    func testMakeSnapshot_extractsValidCarCoordinate() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(geojson: nil, distanceM: nil, durationS: nil, provider: nil, providerBase: nil, updatedAt: nil),
            eta: EtaDTO(routeDurationS: nil, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertNotNil(snapshot.carCoordinate)
        XCTAssertEqual(snapshot.carCoordinate?.latitude, 35.5, accuracy: 0.0001)
        XCTAssertEqual(snapshot.carCoordinate?.longitude, -98.5, accuracy: 0.0001)
    }

    func testMakeSnapshot_extractsValidTargetCoordinate() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(geojson: nil, distanceM: nil, durationS: nil, provider: nil, providerBase: nil, updatedAt: nil),
            eta: EtaDTO(routeDurationS: nil, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertNotNil(snapshot.targetCoordinate)
        XCTAssertEqual(snapshot.targetCoordinate?.latitude, 35.6, accuracy: 0.0001)
        XCTAssertEqual(snapshot.targetCoordinate?.longitude, -98.6, accuracy: 0.0001)
    }

    // MARK: - Tests: Route Ready Detection

    func testMakeSnapshot_routeNotReadyWhenNoGeojson() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(
                geojson: nil,
                distanceM: 12300.0,
                durationS: 900.0,
                provider: "osrm",
                providerBase: "local",
                updatedAt: "2024-01-01T12:00:00Z"
            ),
            eta: EtaDTO(routeDurationS: 900.0, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertFalse(snapshot.isRouteReady)
    }

    func testMakeSnapshot_routeNotReadyWhenGeometryNil() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(
                geojson: GeoJSONMinimalDTO(type: "Feature", geometry: nil),
                distanceM: 12300.0,
                durationS: 900.0,
                provider: "osrm",
                providerBase: "local",
                updatedAt: "2024-01-01T12:00:00Z"
            ),
            eta: EtaDTO(routeDurationS: 900.0, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertFalse(snapshot.isRouteReady)
    }

    func testMakeSnapshot_routeNotReadyWhenCoordinatesEmpty() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(
                geojson: GeoJSONMinimalDTO(
                    type: "Feature",
                    geometry: GeoJSONGeometryDTO(type: "LineString", coordinates: [])
                ),
                distanceM: 12300.0,
                durationS: 900.0,
                provider: "osrm",
                providerBase: "local",
                updatedAt: "2024-01-01T12:00:00Z"
            ),
            eta: EtaDTO(routeDurationS: 900.0, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertFalse(snapshot.isRouteReady)
    }

    func testMakeSnapshot_routeReadyWithValidGeometry() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(
                geojson: GeoJSONMinimalDTO(
                    type: "Feature",
                    geometry: GeoJSONGeometryDTO(
                        type: "LineString",
                        coordinates: [[35.5, -98.5], [35.6, -98.6]]
                    )
                ),
                distanceM: 12300.0,
                durationS: 900.0,
                provider: "osrm",
                providerBase: "local",
                updatedAt: "2024-01-01T12:00:00Z"
            ),
            eta: EtaDTO(routeDurationS: 900.0, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertTrue(snapshot.isRouteReady)
    }

    // MARK: - Tests: Status Message Building

    func testMakeSnapshot_statusWhenRouteNotReady() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(geojson: nil, distanceM: nil, durationS: nil, provider: nil, providerBase: nil, updatedAt: nil),
            eta: EtaDTO(routeDurationS: nil, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertEqual(snapshot.statusLine, "Waiting for route")
    }

    func testMakeSnapshot_statusWhenComputingRoute() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(
                geojson: nil,
                distanceM: 12300.0,
                durationS: 900.0,
                provider: nil,
                providerBase: nil,
                updatedAt: nil
            ),
            eta: EtaDTO(routeDurationS: nil, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertEqual(snapshot.statusLine, "Computing route...")
    }

    func testMakeSnapshot_statusWithRoute() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(
                geojson: GeoJSONMinimalDTO(
                    type: "Feature",
                    geometry: GeoJSONGeometryDTO(
                        type: "LineString",
                        coordinates: [[35.5, -98.5], [35.6, -98.6]]
                    )
                ),
                distanceM: 12300.0,
                durationS: 900.0,
                provider: "osrm",
                providerBase: "local",
                updatedAt: "2024-01-01T12:00:00Z"
            ),
            eta: EtaDTO(routeDurationS: 900.0, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertTrue(snapshot.statusLine.contains("Route"))
        XCTAssertTrue(snapshot.statusLine.contains("12.3 km"))
        XCTAssertTrue(snapshot.statusLine.contains("ETA"))
        XCTAssertTrue(snapshot.statusLine.contains("15:00"))
    }

    func testMakeSnapshot_statusWithShortDuration() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(
                geojson: GeoJSONMinimalDTO(
                    type: "Feature",
                    geometry: GeoJSONGeometryDTO(
                        type: "LineString",
                        coordinates: [[35.5, -98.5], [35.6, -98.6]]
                    )
                ),
                distanceM: 1500.0,
                durationS: 120.0,
                provider: "osrm",
                providerBase: "local",
                updatedAt: "2024-01-01T12:00:00Z"
            ),
            eta: EtaDTO(routeDurationS: 120.0, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertTrue(snapshot.statusLine.contains("1.5 km"))
        XCTAssertTrue(snapshot.statusLine.contains("02:00"))
    }

    func testMakeSnapshot_statusWithLongDuration() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(
                geojson: GeoJSONMinimalDTO(
                    type: "Feature",
                    geometry: GeoJSONGeometryDTO(
                        type: "LineString",
                        coordinates: [[35.5, -98.5], [35.6, -98.6]]
                    )
                ),
                distanceM: 250000.0,
                durationS: 7200.0,
                provider: "osrm",
                providerBase: "local",
                updatedAt: "2024-01-01T12:00:00Z"
            ),
            eta: EtaDTO(routeDurationS: 7200.0, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertTrue(snapshot.statusLine.contains("250.0 km"))
        XCTAssertTrue(snapshot.statusLine.contains("2h00"))
    }

    // MARK: - Tests: Status Message Truncation

    func testMakeSnapshot_statusTruncatesLongMessages() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(
                geojson: GeoJSONMinimalDTO(
                    type: "Feature",
                    geometry: GeoJSONGeometryDTO(
                        type: "LineString",
                        coordinates: [[35.5, -98.5], [35.6, -98.6]]
                    )
                ),
                distanceM: 12300.0,
                durationS: 900.0,
                provider: "osrm",
                providerBase: "local",
                updatedAt: "2024-01-01T12:00:00Z"
            ),
            eta: EtaDTO(routeDurationS: 900.0, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertLessThanOrEqual(snapshot.statusLine.count, CarPlayUIConstraints.maxStatusChars, "Status should not exceed max chars")
    }

    // MARK: - Tests: Action Determination

    func testAllowedActions_whenRouteNotReady() {
        let snapshot = CarPlayNavSnapshot(
            callsign: "W5XYZ",
            carCoordinate: CLLocationCoordinate2D(latitude: 35.5, longitude: -98.5),
            targetCoordinate: CLLocationCoordinate2D(latitude: 35.6, longitude: -98.6),
            routeDistanceMeters: nil,
            routeDurationSeconds: nil,
            payloadTimeToLandingSeconds: 300,
            isRouteReady: false,
            statusLine: "Waiting for route"
        )

        let actions = mapper.allowedActions(for: snapshot)

        XCTAssertEqual(actions.count, 2)
        XCTAssertTrue(actions.contains(.startRoute))
        XCTAssertTrue(actions.contains(.recenterMap))
        XCTAssertFalse(actions.contains(.stopRoute))
        XCTAssertFalse(actions.contains(.refreshRoute))
    }

    func testAllowedActions_whenRouteReady() {
        let snapshot = CarPlayNavSnapshot(
            callsign: "W5XYZ",
            carCoordinate: CLLocationCoordinate2D(latitude: 35.5, longitude: -98.5),
            targetCoordinate: CLLocationCoordinate2D(latitude: 35.6, longitude: -98.6),
            routeDistanceMeters: 12300.0,
            routeDurationSeconds: 900.0,
            payloadTimeToLandingSeconds: 300,
            isRouteReady: true,
            statusLine: "Route 12.3 km, ETA 15:00"
        )

        let actions = mapper.allowedActions(for: snapshot)

        XCTAssertEqual(actions.count, 3)
        XCTAssertTrue(actions.contains(.stopRoute))
        XCTAssertTrue(actions.contains(.recenterMap))
        XCTAssertTrue(actions.contains(.refreshRoute))
        XCTAssertFalse(actions.contains(.startRoute))
    }

    // MARK: - Tests: Edge Cases

    func testMakeSnapshot_withNegativeDistance() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(
                geojson: GeoJSONMinimalDTO(
                    type: "Feature",
                    geometry: GeoJSONGeometryDTO(
                        type: "LineString",
                        coordinates: [[35.5, -98.5], [35.6, -98.6]]
                    )
                ),
                distanceM: -100.0,
                durationS: 900.0,
                provider: "osrm",
                providerBase: "local",
                updatedAt: "2024-01-01T12:00:00Z"
            ),
            eta: EtaDTO(routeDurationS: 900.0, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertTrue(snapshot.statusLine.contains("-"))
    }

    func testMakeSnapshot_withNegativeDuration() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(
                geojson: GeoJSONMinimalDTO(
                    type: "Feature",
                    geometry: GeoJSONGeometryDTO(
                        type: "LineString",
                        coordinates: [[35.5, -98.5], [35.6, -98.6]]
                    )
                ),
                distanceM: 12300.0,
                durationS: -100.0,
                provider: "osrm",
                providerBase: "local",
                updatedAt: "2024-01-01T12:00:00Z"
            ),
            eta: EtaDTO(routeDurationS: 900.0, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertTrue(snapshot.statusLine.contains("-"))
    }

    func testMakeSnapshot_withZeroDuration() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(
                geojson: GeoJSONMinimalDTO(
                    type: "Feature",
                    geometry: GeoJSONGeometryDTO(
                        type: "LineString",
                        coordinates: [[35.5, -98.5], [35.6, -98.6]]
                    )
                ),
                distanceM: 12300.0,
                durationS: 0.0,
                provider: "osrm",
                providerBase: "local",
                updatedAt: "2024-01-01T12:00:00Z"
            ),
            eta: EtaDTO(routeDurationS: 900.0, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertTrue(snapshot.statusLine.contains("00:00"))
    }

    func testMakeSnapshot_withVeryLongRoute() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(
                geojson: GeoJSONMinimalDTO(
                    type: "Feature",
                    geometry: GeoJSONGeometryDTO(
                        type: "LineString",
                        coordinates: [[35.5, -98.5], [35.6, -98.6]]
                    )
                ),
                distanceM: 500000.0,
                durationS: 18000.0,
                provider: "osrm",
                providerBase: "local",
                updatedAt: "2024-01-01T12:00:00Z"
            ),
            eta: EtaDTO(routeDurationS: 18000.0, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertTrue(snapshot.statusLine.contains("500.0 km"))
        XCTAssertTrue(snapshot.statusLine.contains("5h00"))
    }

    func testMakeSnapshot_statusExactslyAtMaxChars() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(
                geojson: GeoJSONMinimalDTO(
                    type: "Feature",
                    geometry: GeoJSONGeometryDTO(
                        type: "LineString",
                        coordinates: [[35.5, -98.5], [35.6, -98.6]]
                    )
                ),
                distanceM: 12300.0,
                durationS: 900.0,
                provider: "osrm",
                providerBase: "local",
                updatedAt: "2024-01-01T12:00:00Z"
            ),
            eta: EtaDTO(routeDurationS: 900.0, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertLessThanOrEqual(snapshot.statusLine.count, CarPlayUIConstraints.maxStatusChars)
    }

    // MARK: - Tests: All CarPlayAction Cases

    func testAllCarPlayActionCasesExist() {
        let allCases = CarPlayAction.allCases
        XCTAssertTrue(allCases.contains(.startRoute))
        XCTAssertTrue(allCases.contains(.stopRoute))
        XCTAssertTrue(allCases.contains(.recenterMap))
        XCTAssertTrue(allCases.contains(.refreshRoute))
    }

    func testCarPlayActionRawValues() {
        XCTAssertEqual(CarPlayAction.startRoute.rawValue, "start_route")
        XCTAssertEqual(CarPlayAction.stopRoute.rawValue, "stop_route")
        XCTAssertEqual(CarPlayAction.recenterMap.rawValue, "recenter_map")
        XCTAssertEqual(CarPlayAction.refreshRoute.rawValue, "refresh_route")
    }

    // MARK: - Tests: Distance Formatting

    func testStatusMessage_distanceFormattingSmall() {
        let state = MobileStateDTO(
            serverTime: "2024-01-01T12:00:00Z",
            car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
            target: TargetDTO(
                callsign: "W5XYZ",
                landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                timeToLanding: nil,
                timeToLandingS: 300
            ),
            route: RouteDTO(
                geojson: GeoJSONMinimalDTO(
                    type: "Feature",
                    geometry: GeoJSONGeometryDTO(
                        type: "LineString",
                        coordinates: [[35.5, -98.5], [35.6, -98.6]]
                    )
                ),
                distanceM: 123.0,
                durationS: 60.0,
                provider: "osrm",
                providerBase: "local",
                updatedAt: "2024-01-01T12:00:00Z"
            ),
            eta: EtaDTO(routeDurationS: 60.0, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
        )

        let snapshot = mapper.makeSnapshot(from: state)

        XCTAssertTrue(snapshot.statusLine.contains("0.1 km"))
    }

    func testStatusMessage_durationFormattingEdgeCases() {
        let cases: [(Double, String)] = [
            (60.0, "01:00"),
            (59.0, "00:59"),
            (3600.0, "1h00"),
            (3660.0, "1h01"),
            (5400.0, "1h30"),
        ]

        for (seconds, expected) in cases {
            let state = MobileStateDTO(
                serverTime: "2024-01-01T12:00:00Z",
                car: CarDTO(lat: 35.5, lon: -98.5, alt: 1000, speed: 10, heading: 45, headingValid: true, lastUpdate: nil),
                target: TargetDTO(
                    callsign: "W5XYZ",
                    landing: LandingDTO(lat: 35.6, lon: -98.6, alt: 1100),
                    timeToLanding: nil,
                    timeToLandingS: 300
                ),
                route: RouteDTO(
                    geojson: GeoJSONMinimalDTO(
                        type: "Feature",
                        geometry: GeoJSONGeometryDTO(
                            type: "LineString",
                            coordinates: [[35.5, -98.5], [35.6, -98.6]]
                        )
                    ),
                    distanceM: 12300.0,
                    durationS: seconds,
                    provider: "osrm",
                    providerBase: "local",
                    updatedAt: "2024-01-01T12:00:00Z"
                ),
                eta: EtaDTO(routeDurationS: seconds, payloadTimeToLandingS: 300, payloadTimeToLanding: nil)
            )

            let snapshot = mapper.makeSnapshot(from: state)

            XCTAssertTrue(snapshot.statusLine.contains(expected), "Expected '\(expected)' in status for \(seconds)s, got: \(snapshot.statusLine)")
        }
    }
}
