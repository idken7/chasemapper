# RouteCalculationService

## Overview

The `RouteCalculationService` provides intelligent route calculation and recomputation management for the ChaseMapper iOS app. It handles the core logic for determining when routes should be recomputed, computing new routes, and calculating distances for navigation decisions.

## Key Features

### 1. Smart Recomputation Logic

The service implements recomputation triggers as specified in `mobile-api-contract.md`:

- **No usable route**: Triggers recomputation when route is `nil` or empty
- **Destination moved ≥ 200m**: Recomputes when target coordinate has shifted significantly
- **Car deviated ≥ 60m**: Recomputes when car has strayed from the current route
- **Debounce (3 seconds)**: Prevents excessive API calls by ignoring requests within 3 seconds of the last computation

### 2. Intelligent Distance Calculations

Uses the **Haversine formula** for accurate geographic distance calculations:

```
distance = 2 * R * arcsin(√(sin²(Δlat/2) + cos(lat1) * cos(lat2) * sin²(Δlon/2)))
```

Where:
- `R` = Earth's radius (~6,371,000 meters)
- `Δlat` = difference in latitudes
- `Δlon` = difference in longitudes

### 3. Point-to-Polyline Distance

Calculates the shortest distance from the car's current position to any point on the route polyline by:

1. Evaluating distance to each line segment
2. Using vector projection to find the closest point on each segment
3. Returning the minimum distance across all segments

This enables accurate detection of route deviations.

### 4. Route Metadata Formatting

Provides human-readable formatting for route data:

- **Distance**: Auto-scales between meters (< 1km) and kilometers (≥ 1km)
- **Duration**: Auto-formats to `M min` or `H:MM h` depending on length
- **ETA**: Calculates arrival time based on current duration

## API Reference

### `shouldRecomputeRoute(previousTarget:newTarget:carPosition:) -> Bool`

Determines if a route recomputation is necessary.

**Parameters:**
- `previousTarget`: Last known target coordinate (optional)
- `newTarget`: Current target coordinate
- `carPosition`: Current car position (optional)

**Returns:** `true` if route should be recomputed

**Logic:**
```swift
// Recompute if:
1. No usable route exists
2. Destination moved >= 200m
3. Car deviated >= 60m from route
```

### `computeRoute(from:to:) async throws -> RouteState`

Computes a new route between start and end coordinates.

**Parameters:**
- `from`: Starting coordinate
- `to`: Ending coordinate

**Returns:** `RouteState` with computed route geometry and metadata

**Throws:** `APIError` if computation fails (falls back to last known route if available)

**Behavior:**
- Respects 3-second debounce interval
- Caches result for fallback on subsequent errors
- Updates internal timestamp for debounce tracking

### `distanceFromRoute(carPosition:routeCoordinates:) -> CLLocationDistance`

Calculates shortest distance from car to route polyline.

**Parameters:**
- `carPosition`: Current car position
- `routeCoordinates`: Array of route coordinate points

**Returns:** Distance in meters (`.infinity` if no coordinates provided)

**Implementation:**
- Handles empty routes
- Special case for single-point routes
- Uses segment-based distance calculation for multi-point routes

### `formatRouteMetadata(distance:duration:) -> (String, String, String?)`

Formats route metadata for UI display.

**Parameters:**
- `distance`: Distance in meters (optional)
- `duration`: Duration in seconds (optional)

**Returns:** Tuple of `(distanceString, durationString, eta)`

**Examples:**
```
distance: 5000, duration: 600
→ ("5.0 km", "10 min", "2:45 PM")

distance: 500, duration: 120
→ ("500 m", "2 min", "2:32 PM")
```

### `reset()`

Resets all service state. Useful when canceling a route or switching targets.

## Integration with MobileStateViewModel

The `MobileStateViewModel` uses `RouteCalculationService` for all route computation logic:

```swift
private let routeCalculationService: RouteCalculationService

// During state updates
private func checkAndRecomputeRoute() {
    let shouldRecompute = routeCalculationService.shouldRecomputeRoute(
        previousTarget: lastTargetCoordinate,
        newTarget: targetCoord,
        carPosition: carPosition
    )
    
    if shouldRecompute {
        computeRoute(from: carCoord, to: targetCoord)
    }
}

// When computing route
private func computeRoute(from start: CLLocationCoordinate2D, to end: CLLocationCoordinate2D) {
    Task {
        let routeState = try await routeCalculationService.computeRoute(from: start, to: end)
        self.route = routeState
    }
}
```

## Error Handling

The service implements graceful error handling:

### Route Computation Errors

When `computeRoute()` fails:
1. Attempts to use last known good route if available
2. Otherwise throws the original error
3. Errors are handled in `MobileStateViewModel` with user-facing messages

### Custom Error Types

- `RouteCalculationError.debounceActive`: Request ignored due to debounce
- `RouteCalculationError.noRouteAvailable`: No route has been computed yet
- `RouteCalculationError.invalidCoordinates`: Invalid coordinate data provided

## Performance Considerations

### Debounce Strategy

The 3-second debounce interval (from `automotive-ui-constraints.md`) prevents:
- Excessive API calls during rapid navigation updates
- UI thrashing from constant route recomputation
- Network resource exhaustion

**Debounce Flow:**
```
Request 1 → Computed (t=0s)
Request 2 → Debounced, returns cached route (t=1s)
Request 3 → Debounced, returns cached route (t=2s)
Request 4 → Computed (t=3.1s)
```

### Distance Calculation Efficiency

- **Haversine formula**: O(1) computation, accurate for all distances
- **Point-to-polyline**: O(n) where n = number of route segments
- Typical routes have 50-500 segments, making calculations sub-millisecond

## Testing

The `RouteCalculationServiceTests` suite covers:

- Recomputation trigger detection (destination moved, deviation, no route)
- Distance calculations (Haversine, point-to-segment)
- Metadata formatting (various distance/duration ranges)
- Empty and edge case handling

To run tests:
```bash
swift test --filter RouteCalculationServiceTests
```

## API Contract Reference

This service implements behavior specified in:

1. **mobile-api-contract.md** (Section: Triggered Re-route Rules)
   - 200m destination movement threshold
   - 60m route deviation threshold
   - Debounce logic guidance

2. **automotive-ui-constraints.md** (Section: Shared Constraints)
   - 3-second route recompute debounce
   - In-car action constraints

## See Also

- `APIService.computeRoute()` - Server-side route computation endpoint
- `MobileStateViewModel` - Integration point
- `RouteState` - Route data model
- `mobile-api-contract.md` - API specifications
