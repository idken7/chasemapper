# iOS Models Quick Reference

## File Organization

| File | Purpose | Key Types |
|------|---------|-----------|
| **DTOs.swift** | API Contracts | `ErrorDTO`, `RouteRequestDTO`, `RouteResponseDTO`, `CarDTO`, `TargetDTO`, `GeoJSONFeature` |
| **MobileState.swift** | Mobile State & CarPlay | `MobileStateDTO`, `CarPlayNavSnapshot`, `CarPlayStateMapper`, `CarPlayAction` |
| **Route.swift** | Route Models | `RouteRequest`, `RouteResponse`, `RouteState`, `RouteMetadata` |
| **Telemetry.swift** | Telemetry Data | `TelemetrySnapshot`, `TelemetryHistory`, `TelemetryChangeDetector`, Coordinate extensions |

## Common Tasks

### Parse API Response (GET /api/mobile_state)
```swift
let decoder = JSONDecoder()
let state = try decoder.decode(MobileStateDTO.self, from: data)
```

### Create Route Request (POST /api/route)
```swift
let req = RouteRequest(from: carCoord, to: targetCoord)
let encoded = try JSONEncoder().encode(req)
```

### Get Route Coordinates for Map
```swift
let coords = state.route.geojson?.geometry.coordinates
    .compactMap { pair in
        CLLocationCoordinate2D(latitude: pair[1], longitude: pair[0])
    } ?? []
```

### Format Route Display
```swift
let metadata = RouteMetadata(from: state.route)
label.text = "\(metadata.formattedDistance), \(metadata.formattedDuration)"
```

### CarPlay Safe Snapshot
```swift
let mapper = CarPlayStateMapper()
let carPlaySnapshot = mapper.makeSnapshot(from: mobileState)
```

### Track Telemetry History
```swift
let history = TelemetryHistory(maxSize: 100)
history.append(snapshot)
let vVel = history.estimatedVerticalVelocity()
```

### Detect Significant Changes
```swift
let detector = TelemetryChangeDetector()
if detector.isSignificantChange(from: old, to: new) {
    // Update UI
}
```

### Calculate Distance & Bearing
```swift
let distance = coord1.distance(to: coord2)  // meters
let bearing = coord1.bearing(to: coord2)    // degrees
```

## Protocol Conformances

| Type | Codable | Equatable | Notes |
|------|---------|-----------|-------|
| `MobileStateDTO` | ✅ | ✅ | API response model |
| `CarPlayNavSnapshot` | ❌ | ✅ | Custom Equatable (CLLocationCoordinate2D) |
| `TelemetrySnapshot` | ✅ | ✅ | Serializable telemetry |
| `RouteRequest` | ✅ | ✅ | HTTP POST body |
| `GeoJSONFeature` | ✅ | ✅ | GeoJSON standard |

## CodingKeys Mapping

Common snake_case API fields:
```swift
"server_time"           → serverTime
"heading_valid"         → headingValid
"last_update"           → lastUpdate
"time_to_landing"       → timeToLanding
"time_to_landing_s"     → timeToLandingS
"distance_m"            → distanceM
"duration_s"            → durationS
"provider_base"         → providerBase
"updated_at"            → updatedAt
"route_duration_s"      → routeDurationS
"payload_time_to_landing_s" → payloadTimeToLandingS
"payload_time_to_landing"   → payloadTimeToLanding
```

## Validation Properties

```swift
snapshot.hasValidAltitude   // alt != nil && !isNaN
snapshot.hasValidHeading    // heading in [0, 360)
snapshot.hasValidSpeed      // speed >= 0 && !isNaN
```

## CarPlay Constraints

```swift
maxPrimaryButtons = 3
maxStatusChars = 42
routeRecalcDebounceSeconds = 3.0

// Safe actions depend on route readiness
routeReady: [.stopRoute, .recenterMap, .refreshRoute]
routeNotReady: [.startRoute, .recenterMap]
```

## Error Handling

```swift
struct ErrorDTO {
    let error: String           // Error message
    let retryAfterS: Int?       // Seconds to wait before retry
}
```

## Type Conversions

```swift
// Coordinate conversion
let coord = TelemetrySnapshot(...).coordinate
let coords = RouteResponse(...).coordinates  // [CLLocationCoordinate2D]

// Formatting
let formatted = RouteMetadata(...).formattedDistance  // "12.5 km" or "500 m"
let formatted = RouteMetadata(...).formattedDuration  // "15:30" or "1:15:30"

// Status truncation (safe for CarPlay)
let safe = CarPlayUIConstraints.truncateStatus(text)  // Max 42 chars
```

## Subscripts & Accessors

```swift
MobileStateDTO:
  .serverTime                   // String (ISO 8601)
  .car?.lat, .car?.lon          // Double? for position
  .target?.callsign             // String (payload name)
  .target?.landing              // LandingDTO with lat/lon
  .route                        // RouteDTO (always present)
  .route.geojson?.geometry      // GeoJSONGeometry?
  .eta.routeDurationS           // Double? (seconds)
  
RouteState:
  .isEmpty                      // Bool
  .coordinates                  // [CLLocationCoordinate2D]
  
TelemetrySnapshot:
  .timestamp                    // Date
  .coordinate                   // CLLocationCoordinate2D (computed)
  
TelemetryHistory:
  .latest()                     // TelemetrySnapshot?
  .all()                        // [TelemetrySnapshot]
  .count                        // Int
```

## Thread Safety

- `TelemetryHistory` is not thread-safe; use from MainActor/UI thread
- `CarPlayStateMapper` is thread-safe (stateless)
- `TelemetryChangeDetector` is thread-safe (stateless)
- All DTOs are value types (thread-safe for reading)

## Performance Notes

- `TelemetryHistory.estimatedVelocity()` - O(n) scan in time window
- `CLLocationCoordinate2D.distance()` - Haversine formula (~100ns)
- `CLLocationCoordinate2D.bearing()` - Bearing calc (~100ns)
- GeoJSON parsing - Linear in coordinate count
- CarPlay mapper - O(1) state projection

## Debugging Tips

```swift
// Inspect decoded model
print(mobileState)  // Prints full structure

// Check CodingKeys mismatch
JSONDecoder().decode(MobileStateDTO.self, from: invalidData)
// Error: keyNotFound(CodingKeys..., Context...)

// Validate GeoJSON
if state.route.geojson?.geometry.type != "LineString" {
    print("Unexpected geometry type")
}

// Telemetry validation
if !snapshot.hasValidAltitude {
    print("Altitude data unavailable or invalid")
}
```
