# CarPlayStateMapper Enhancement Guide

## Overview

The enhanced `CarPlayStateMapper` is a critical component for safe CarPlay in-car navigation. It converts flexible backend data (`MobileStateDTO`) into driver-safe, time-constrained UI state (`CarPlayNavSnapshot`) that respects CarPlay's design constraints and ensures distraction-free operation.

## Key Features

### 1. Enhanced Snapshot Projection

```swift
func makeSnapshot(from state: MobileStateDTO) -> CarPlayNavSnapshot
```

**Purpose**: Projects mobile state to driver UI with:
- Automatic nil/null field handling
- Coordinate conversion to CLLocationCoordinate2D
- Route readiness determination
- Status message generation with 42-char limit

**Key Enhancements**:
- **Nil Field Handling**: Gracefully handles missing car state, target state, and route geometry
- **Coordinate Validation**: Uses `CLLocationCoordinate2DIsValid()` to reject invalid lat/lon values (outside ±90/±180)
- **Route Detection**: Checks geometry existence and coordinate array, not just geojson presence
- **Status Context**: Detects "computing route" state when metrics exist but geometry doesn't

### 2. Action Determination Logic

```swift
func allowedActions(for snapshot: CarPlayNavSnapshot) -> [CarPlayAction]
```

**Returns based on route readiness**:
- **Route Not Ready**: `[.startRoute, .recenterMap]`
  - User can initiate route computation or recenter map
- **Route Ready**: `[.stopRoute, .recenterMap, .refreshRoute]`
  - User can stop navigation, recenter map, or refresh (handles rerouting)

**Safety Pattern**: Enforces CarPlayUIConstraints.maxPrimaryButtons (3 buttons maximum)

### 3. Status Message Building

```swift
// Examples:
"Waiting for route"        // No route data yet
"Computing route..."       // Distance/duration exist but geometry doesn't
"Route 12.3 km, ETA 15:00" // Route ready, under 1 hour
"Route 250.0 km, ETA 5h00" // Route ready, over 1 hour
```

**Constraints Enforced**:
- **Max 42 characters**: Enforced by `CarPlayUIConstraints.truncateStatus()`
- **Proper truncation**: Cuts at character boundary, not word boundary
- **Distance formatting**: Meters → km with 1 decimal place
- **Duration formatting**:
  - Under 1 hour: `MM:SS` format (e.g., `15:00`)
  - 1+ hours: `Xh` or `Xh0Y` format (e.g., `2h30`, `1h`)
  - Negative/missing values shown as `-`

### 4. Nil/Empty Field Handling

All extraction methods are defensive:

```swift
// Callsign Extraction
// Returns "No target" if:
// - target is nil
// - callsign is empty or whitespace-only

// Coordinate Extraction  
// Returns nil if:
// - parent object (car/target) is nil
// - lat or lon is nil
// - coordinates outside valid ranges (lat: ±90, lon: ±180)

// Route Readiness
// Returns false if:
// - geojson is nil
// - geometry is nil
// - coordinates are nil or empty array
```

## Data Models

### Input: MobileStateDTO

```swift
struct MobileStateDTO: Codable, Equatable {
    let serverTime: String
    let car: CarDTO?              // Optional car position
    let target: TargetDTO?        // Optional target info
    let route: RouteDTO           // Current route attempt
    let eta: EtaDTO               // ETA calculations
}
```

### Output: CarPlayNavSnapshot

```swift
struct CarPlayNavSnapshot: Equatable {
    let callsign: String                      // "W5XYZ" or "No target"
    let carCoordinate: CLLocationCoordinate2D? // Car location
    let targetCoordinate: CLLocationCoordinate2D? // Target location
    let routeDistanceMeters: Double?          // Raw meters
    let routeDurationSeconds: Double?         // Raw seconds
    let payloadTimeToLandingSeconds: Int?     // Target landing time
    let isRouteReady: Bool                    // Route has geometry
    let statusLine: String                    // ≤42 chars display text
}
```

### Actions: CarPlayAction

```swift
enum CarPlayAction: String, CaseIterable, Codable {
    case startRoute = "start_route"       // Begin route computation
    case stopRoute = "stop_route"         // Stop following route
    case recenterMap = "recenter_map"     // Recenter map on car
    case refreshRoute = "refresh_route"   // Recompute route
}
```

## UI Constraints

```swift
enum CarPlayUIConstraints {
    static let maxPrimaryButtons = 3              // Max buttons per template
    static let maxStatusChars = 42                // Status line limit
    static let routeRecalcDebounceSeconds = 3.0   // Debounce time
    
    static func truncateStatus(_ text: String) -> String
    static func allowedActions(for: CarPlayNavSnapshot) -> [CarPlayAction]
}
```

## Usage Examples

### Basic Usage

```swift
let mapper = CarPlayStateMapper()

// Get current snapshot
let snapshot = mapper.makeSnapshot(from: mobileState)

// Display to driver
print("Route: \(snapshot.statusLine)")  // "Route 12.3 km, ETA 15:00"
print("Callsign: \(snapshot.callsign)") // "W5XYZ"

// Determine available actions
let actions = mapper.allowedActions(for: snapshot)
// → [.stopRoute, .recenterMap, .refreshRoute]
```

### State Transitions

```
Initial State:
  statusLine: "Waiting for route"
  isRouteReady: false
  actions: [.startRoute, .recenterMap]

↓ [User starts route]

Computing State:
  statusLine: "Computing route..."
  isRouteReady: false
  actions: [.startRoute, .recenterMap]

↓ [Route computed]

Ready State:
  statusLine: "Route 12.3 km, ETA 15:00"
  isRouteReady: true
  actions: [.stopRoute, .recenterMap, .refreshRoute]
```

## Testing

Comprehensive test suite in `CarPlayStateMapperTests.swift`:

- **Nil/Empty Handling**: 6 tests for missing or invalid data
- **Coordinate Extraction**: 3 tests for valid and invalid coordinates
- **Route Ready Detection**: 5 tests for various route states
- **Status Message Building**: 4 tests for formatting and content
- **Status Truncation**: 3 tests including edge cases
- **Action Determination**: 2 tests for route ready/not ready states
- **Edge Cases**: 6 tests for negative values, very long routes, etc.
- **Duration Formatting**: 5 test cases covering MM:SS and hour formats
- **All CarPlayAction Cases**: Coverage for all enum values

**Total**: 34 test methods validating core functionality

### Example Tests

```swift
// Route not ready → appropriate actions
testAllowedActions_whenRouteNotReady()

// Invalid coordinates → rejected safely
testMakeSnapshot_withInvalidCoordinates()

// Long route → proper hour formatting
testMakeSnapshot_withVeryLongRoute()

// Status at limit → respects max chars
testMakeSnapshot_statusExactslyAtMaxChars()
```

## Safety Considerations

### In-Car Distraction Minimization

1. **Fixed Action Set**: Only 4 pre-defined CarPlayAction cases
2. **Status Length**: Hard 42-character limit prevents scrolling
3. **No Free-Form Input**: All data comes from validated state snapshots
4. **Debounce Delays**: Built-in 3-second route recalc debounce
5. **Coordinate Validation**: Rejects geographic impossibilities

### Error Recovery

- **Missing Data**: Falls back to sensible defaults ("No target", "-")
- **Invalid Coordinates**: Silently returns nil, templates handle nil gracefully
- **Malformed Route**: Detects at multiple validation points
- **Truncation**: Always safe, never throws

## Performance Notes

- **Snapshot Creation**: O(1) operation, minimal allocations
- **Action Determination**: Single boolean check
- **String Formatting**: Minimal allocation via format specifiers
- **Coordinate Validation**: Uses CoreLocation's built-in validation

## Integration Points

### With CarPlay Templates

CarPlayNavSnapshot feeds directly into:
- `CPMapTemplate` - uses coordinates and status line
- `CPListTemplate` - displays actions
- `CPInformationTemplate` - shows route details

### With Backend

MobileStateDTO comes from `/api/mobile_state` endpoint:
- Called periodically for updates
- Mapper converts to snapshot in real-time
- Actions trigger callbacks that send user intent back to backend

## Future Enhancements

Potential additions maintaining safety constraints:
- ETA computation combining route duration + payload TTL
- Vehicle speed consideration for action availability
- Geofence notifications for driver awareness
- Route alternatives presentation (if time permits)
