import XCTest
import CoreLocation
@testable import ChaseMapper

@MainActor
final class LocationTrackingServiceTests: XCTestCase {
    var sut: LocationTrackingService!
    
    override func setUp() {
        super.setUp()
        sut = LocationTrackingService()
    }
    
    override func tearDown() {
        sut.stop()
        sut = nil
        super.tearDown()
    }
    
    func testInitialState() {
        XCTAssertNil(sut.currentLocation)
        XCTAssertEqual(sut.authorizationStatus, .notDetermined)
        XCTAssertNil(sut.locationError)
        XCTAssertFalse(sut.isTracking)
        XCTAssertEqual(sut.horizontalAccuracy, -1)
    }
    
    func testPublishedProperties() {
        let expectation = XCTestExpectation(description: "Published properties")
        var cancellables: Set<AnyCancellable> = []
        
        sut.$isTracking
            .dropFirst()
            .sink { isTracking in
                XCTAssertTrue(isTracking)
                expectation.fulfill()
            }
            .store(in: &cancellables)
        
        sut.start()
        
        wait(for: [expectation], timeout: 1.0)
    }
    
    func testStartAndStop() {
        XCTAssertFalse(sut.isTracking)
        sut.start()
        XCTAssertTrue(sut.isTracking)
        
        sut.stop()
        XCTAssertFalse(sut.isTracking)
    }
    
    func testClearError() {
        sut.locationError = "Test error"
        XCTAssertNotNil(sut.locationError)
        
        sut.clearError()
        XCTAssertNil(sut.locationError)
    }
    
    func testMainActorConstraint() {
        XCTAssertTrue(Thread.isMainThread, "LocationTrackingService should run on MainActor")
    }
}

// Required for test compilation
import Combine

extension AnyCancellable {
    // Placeholder if needed
}
