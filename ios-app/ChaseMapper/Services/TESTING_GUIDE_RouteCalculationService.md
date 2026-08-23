# RouteCalculationService Testing Guide

## Unit Tests

### Test 1: Recomputation Triggers

```swift
func testShouldRecomputeRoute_NoRouteExists() {
    let target = CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060)
    let result = service.shouldRecomputeRoute(
        previousTarget: nil,
        newTarget: target,
        carPosition: nil
    )
    XCTAssertTrue(result)
}
```

**What it tests:** Service correctly identifies when no route exists and recomputation is needed.

---

### Test 2: Destination Movement Detection

```swift
func testShouldRecomputeRoute_DestinationMoved200m() {
    // Setup: Create two points ~200m apart
    let previous = CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060)
    let current = CLLocationCoordinate2D(latitude: 40.7143, longitude: -74.0060)
    
    // Setup: Establish a route first
    service.lastComputedRoute = createMockRoute()
    
    let result = service.shouldRecomputeRoute(
        previousTarget: previous,
        newTarget: current,
        carPosition: CLLocationCoordinate2D(latitude: 40.7100, longitude: -74.0100)
    )
    
    XCTAssertTrue(result, "Should recompute when target moved >= 200m")
}
```

**What it tests:** Destination movement detection at the 200m threshold.

---

### Test 3: Route Deviation Detection

```swift
func testShouldRecomputeRoute_CarDeviated60m() {
    // Create route coordinates
    let routeCoords: [[Double]] = [
        [-74.0060, 40.7100],
        [-74.0060, 40.7128],
        [-74.0060, 40.7150]
    ]
    
    // Car is 60m+ away from route
    let carPosition = CLLocationCoordinate2D(latitude: 40.7200, longitude: -74.0060)
    
    let result = service.shouldRecomputeRoute(
        previousTarget: CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060),
        newTarget: CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060),
        carPosition: carPosition
    )
    
    XCTAssertTrue(result, "Should recompute when car deviated >= 60m")
}
```

**What it tests:** Car off-route detection at the 60m threshold.

---

### Test 4: Distance Calculation (Haversine)

```swift
func testHaversineDistance() {
    // San Francisco to Los Angeles (~500km)
    let sf = CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194)
    let la = CLLocationCoordinate2D(latitude: 34.0522, longitude: -118.2437)
    
    // Create service to access private method via reflection or wrapper
    let distance = testableDistance(from: sf, to: la)
    
    // SF to LA is approximately 550-600km
    XCTAssertGreaterThan(distance, 500_000) // > 500km
    XCTAssertLessThan(distance, 650_000)    // < 650km
}
```

**What it tests:** Geographic distance calculation accuracy using Haversine.

---

### Test 5: Point-to-Line Distance

```swift
func testDistanceFromRoute_PointNearSegment() {
    let carPosition = CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060)
    
    // Route passes through this exact point
    let routeCoords = [
        CLLocationCoordinate2D(latitude: 40.7100, longitude: -74.0100),
        CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060),
        CLLocationCoordinate2D(latitude: 40.7150, longitude: -74.0020)
    ]
    
    let distance = service.distanceFromRoute(
        carPosition: carPosition,
        routeCoordinates: routeCoords
    )
    
    // Distance should be very small (< 50m)
    XCTAssertLessThan(distance, 50)
}
```

**What it tests:** Accurate distance calculation from point to polyline segment.

---

### Test 6: Debounce Behavior

```swift
func testDebouncePreventsDuplicateComputation() async {
    let start = CLLocationCoordinate2D(latitude: 40.7100, longitude: -74.0100)
    let end = CLLocationCoordinate2D(latitude: 40.7150, longitude: -74.0050)
    
    // First request
    let route1 = try? await service.computeRoute(from: start, to: end)
    XCTAssertNotNil(route1)
    
    // Second request within 3 seconds should be debounced
    let route2 = try? await service.computeRoute(from: start, to: end)
    
    // Both should return same route (debounced)
    XCTAssertEqual(route1?.distanceM, route2?.distanceM)
}
```

**What it tests:** 3-second debounce interval prevents duplicate API calls.

---

### Test 7: Metadata Formatting

```swift
func testFormatMetadata_LargeDistance() {
    let (distStr, durStr, eta) = service.formatRouteMetadata(
        distance: 50_000,  // 50km
        duration: 3600     // 1 hour
    )
    
    XCTAssertTrue(distStr.contains("km"), "Large distance should use km")
    XCTAssertTrue(durStr.contains(":"), "1+ hour should show H:MM format")
    XCTAssertNotNil(eta, "ETA should be calculated")
}

func testFormatMetadata_SmallDistance() {
    let (distStr, durStr, _) = service.formatRouteMetadata(
        distance: 500,     // 500m
        duration: 120      // 2 minutes
    )
    
    XCTAssertTrue(distStr.contains("m"), "Small distance should use meters")
    XCTAssertTrue(durStr.contains("min"), "Should show minutes")
}
```

**What it tests:** Metadata formatting for various distance/duration ranges.

---

## Integration Tests

### Test 8: Full Route Computation Flow

```swift
func testFullRouteComputationFlow() async {
    // Setup
    let start = CLLocationCoordinate2D(latitude: 40.7100, longitude: -74.0100)
    let end = CLLocationCoordinate2D(latitude: 40.7150, longitude: -74.0050)
    
    // Act
    let route = try? await service.computeRoute(from: start, to: end)
    
    // Assert
    XCTAssertNotNil(route)
    XCTAssertNotNil(route?.geojson)
    XCTAssertGreaterThan(route?.distanceM ?? 0, 0)
    XCTAssertGreaterThan(route?.durationS ?? 0, 0)
    XCTAssertNotNil(route?.updatedAt)
}
```

**What it tests:** End-to-end route computation with API integration.

---

### Test 9: Error Fallback to Last Known Route

```swift
func testComputeRoute_FallbackToLastKnownRoute() async {
    // Setup: First successful computation
    let start = CLLocationCoordinate2D(latitude: 40.7100, longitude: -74.0100)
    let end = CLLocationCoordinate2D(latitude: 40.7150, longitude: -74.0050)
    
    let route1 = try? await service.computeRoute(from: start, to: end)
    XCTAssertNotNil(route1)
    
    // Setup: Mock failure after 3 seconds
    try? await Task.sleep(nanoseconds: 3_500_000_000)
    mockAPIService.shouldFailRoute = true
    
    // Act: Attempt computation while failing
    let route2 = try? await service.computeRoute(from: start, to: end)
    
    // Assert: Should return last known route despite failure
    XCTAssertNotNil(route2, "Should fallback to last known route")
    XCTAssertEqual(route1?.distanceM, route2?.distanceM)
}
```

**What it tests:** Graceful degradation with cached route fallback.

---

## Performance Tests

### Test 10: Distance Calculation Performance

```swift
func testDistanceCalculationPerformance() {
    let carPosition = CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060)
    let routeCoords = generateMockRoute(pointCount: 500)  // 500-point route
    
    measure {
        _ = service.distanceFromRoute(
            carPosition: carPosition,
            routeCoordinates: routeCoords
        )
    }
}
```

**Expected:** < 10ms for typical 100-500 point routes.

---

### Test 11: Debounce Accuracy

```swift
func testDebounceTimingAccuracy() async {
    var computationCount = 0
    
    // Mock to track computation calls
    mockAPIService.onComputeRoute = { _ in
        computationCount += 1
    }
    
    let start = CLLocationCoordinate2D(latitude: 40.7100, longitude: -74.0100)
    let end = CLLocationCoordinate2D(latitude: 40.7150, longitude: -74.0050)
    
    // Request 1: Should compute
    _ = try? await service.computeRoute(from: start, to: end)
    XCTAssertEqual(computationCount, 1)
    
    // Request 2 (1 second later): Should NOT compute
    try? await Task.sleep(nanoseconds: 1_000_000_000)
    _ = try? await service.computeRoute(from: start, to: end)
    XCTAssertEqual(computationCount, 1, "Should not compute within debounce")
    
    // Request 3 (3.5 seconds after first): Should compute
    try? await Task.sleep(nanoseconds: 2_500_000_000)
    _ = try? await service.computeRoute(from: start, to: end)
    XCTAssertEqual(computationCount, 2, "Should compute after debounce expires")
}
```

**Expected:** Exact 3-second debounce window respected.

---

## Edge Case Tests

### Test 12: Empty Route Handling

```swift
func testDistanceFromRoute_EmptyRoute() {
    let carPosition = CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060)
    let distance = service.distanceFromRoute(
        carPosition: carPosition,
        routeCoordinates: []
    )
    
    XCTAssertEqual(distance, .infinity)
}
```

---

### Test 13: Single Point Route

```swift
func testDistanceFromRoute_SinglePoint() {
    let carPosition = CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060)
    let routePoint = CLLocationCoordinate2D(latitude: 40.7100, longitude: -74.0100)
    
    let distance = service.distanceFromRoute(
        carPosition: carPosition,
        routeCoordinates: [routePoint]
    )
    
    XCTAssertGreaterThan(distance, 0)
    XCTAssertLessThan(distance, .infinity)
}
```

---

### Test 14: Nil Metadata Values

```swift
func testFormatMetadata_NilValues() {
    let (distStr, durStr, eta) = service.formatRouteMetadata(
        distance: nil,
        duration: nil
    )
    
    XCTAssertEqual(distStr, "--")
    XCTAssertEqual(durStr, "--")
    XCTAssertNil(eta)
}
```

---

## Running Tests

### Run all tests
```bash
swift test
```

### Run specific test class
```bash
swift test --filter RouteCalculationServiceTests
```

### Run specific test method
```bash
swift test --filter RouteCalculationServiceTests.testShouldRecomputeRoute_DestinationMoved200m
```

### Run with verbose output
```bash
swift test --verbose
```

### Generate coverage report
```bash
swift test --enable-code-coverage
xcrun llvm-cov report .build/debug/ChaseMapperTests.xctest/Contents/MacOS/ChaseMapperTests
```

---

## Test Coverage Goals

| Component | Target |
|-----------|--------|
| Recomputation logic | 100% |
| Distance calculations | 100% |
| Debounce mechanism | 100% |
| Formatting functions | 95%+ |
| Error handling | 90%+ |
| Integration flows | 85%+ |

---

## Debugging Test Failures

### Haversine Distance Off
- Verify Earth radius constant (6,371,000 meters)
- Check degree-to-radian conversion
- Validate test coordinate pairs

### Debounce Not Working
- Check system time (test infrastructure may affect timing)
- Verify task scheduling
- Ensure mocks update timestamps correctly

### Point-to-Line Distance Inaccurate
- Print intermediate projection calculations
- Verify latitude/longitude order (lat, lon vs lon, lat)
- Check vector math in segment calculation

### Integration Test Hangs
- Ensure mock API service completes
- Verify task cancellation doesn't deadlock
- Check for infinite loops in recursive calculations
