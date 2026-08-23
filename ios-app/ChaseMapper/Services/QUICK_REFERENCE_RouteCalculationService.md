# Quick Reference: RouteCalculationService

## Usage

### Initialize
```swift
let routeService = RouteCalculationService()

// Or with custom API service
let routeService = RouteCalculationService(apiService: customAPIService)
```

### Check if Route Needs Recomputation
```swift
let shouldRecompute = routeService.shouldRecomputeRoute(
    previousTarget: lastTarget,
    newTarget: currentTarget,
    carPosition: carPosition
)

if shouldRecompute {
    await computeNewRoute()
}
```

### Compute Route
```swift
do {
    let route = try await routeService.computeRoute(
        from: carCoordinate,
        to: targetCoordinate
    )
    
    updateMapWithRoute(route)
} catch {
    handleError(error)
}
```

### Calculate Distance to Route
```swift
let deviation = routeService.distanceFromRoute(
    carPosition: car,
    routeCoordinates: route.coordinates
)

if deviation > 60 {
    showWarning("Off-route by \(Int(deviation))m")
}
```

### Format Metadata
```swift
let (distStr, durStr, eta) = routeService.formatRouteMetadata(
    distance: route.distanceM,
    duration: route.durationS
)

label.text = "\(distStr) • \(durStr) • ETA: \(eta ?? "?")"
// Example: "5.0 km • 10 min • ETA: 2:45 PM"
```

## Thresholds

| Trigger | Value |
|---------|-------|
| Destination move | ≥ 200m |
| Route deviation | ≥ 60m |
| Navigation proximity | ≤ 30m |
| Debounce interval | 3 seconds |

## Error Handling

```swift
do {
    let route = try await routeService.computeRoute(from: start, to: end)
} catch let error as RouteCalculationError {
    switch error {
    case .debounceActive:
        print("Wait before retrying")
    case .noRouteAvailable:
        print("No route computed yet")
    case .invalidCoordinates:
        print("Invalid coordinates")
    }
} catch {
    print("Other error: \(error)")
}
```

## State Management

```swift
// Reset service when canceling route
routeService.reset()

// Check if route needs update
let needsUpdate = shouldRecomputeRoute(...)

// Debounce automatically managed
// (requests < 3s apart return cached route)
```

## Coordinate Conversion

```swift
// CLLocationCoordinate2D to CLLocationCoordinate2D[]
let routeCoordinates: [CLLocationCoordinate2D] = route.coordinates

// CLLocationCoordinate2D from double pair
let coord = CLLocationCoordinate2D(
    latitude: 40.7128,
    longitude: -74.0060
)
```

## Testing

```swift
let service = RouteCalculationService(apiService: mockAPI)

// Mock should fail
mockAPI.shouldFailRoute = true

// Verify recompute logic
let shouldRecompute = service.shouldRecomputeRoute(
    previousTarget: CLLocationCoordinate2D(...),
    newTarget: CLLocationCoordinate2D(...),
    carPosition: CLLocationCoordinate2D(...)
)

// Verify debounce
let route1 = try await service.computeRoute(from: a, to: b)  // Computed
let route2 = try await service.computeRoute(from: a, to: b)  // Debounced
```
