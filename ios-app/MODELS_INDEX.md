# iOS Models Index

## Quick Navigation

### 📁 Model Files

#### [DTOs.swift](ChaseMapper/Models/DTOs.swift) - API Contract Models
Core data transfer objects for API communication.

**API Error Handling**
- `ErrorDTO` - Standardized API error responses with retry-after support

**GeoJSON Models**
- `GeoJSONFeature` - Complete GeoJSON feature (type + geometry + properties)
- `GeoJSONGeometry` - GeoJSON LineString geometry with coordinate pairs
- `JSONValue` - Extensible enum for arbitrary JSON values (string, int, double, bool, array, object, null)

**Route API Models**
- `RouteRequestDTO` - Request body for POST /api/route
- `RouteResponseDTO` - Response from route calculation endpoint

**Car & Target State**
- `CarDTO` - Chase car position, speed, heading (from /api/mobile_state)
- `TargetDTO` - Target payload state with callsign and landing coordinates
- `LandingDTO` - Target landing coordinates (lat, lon, alt)

**Route State Models**
- `RouteDTO` - Route information from /api/mobile_state
- `GeoJSONMinimalDTO` - Minimal GeoJSON wrapper in mobile_state
- `GeoJSONGeometryDTO` - Minimal geometry in mobile_state
- `EtaDTO` - ETA and duration estimates

**All models conform to:** `Codable`, `Equatable`

---

#### [MobileState.swift](ChaseMapper/Models/MobileState.swift) - Application State & CarPlay
Complete app state models and driver-safe CarPlay integration.

**Application State**
- `MobileStateDTO` - Complete snapshot from /api/mobile_state endpoint
  - serverTime, car position, target info, route, ETA
  - Entry point for all app state updates

**CarPlay Integration**
- `CarPlayNavSnapshot` - Driver-safe, compact state for CarPlay templates
  - Pre-converted CLLocationCoordinate2D coordinates
  - Formatted strings for safe in-car display
  - Status line with route distance and ETA
  - Custom Equatable implementation for CLLocationCoordinate2D

- `CarPlayAction` - Restricted action set for CarPlay UI
  - startRoute, stopRoute, recenterMap, refreshRoute

- `CarPlayUIConstraints` - Safety limits and utilities
  - maxPrimaryButtons = 3 (in-car safety)
  - maxStatusChars = 42 (readable display limit)
  - truncateStatus() - safe string truncation
  - allowedActions() - context-aware action filtering

**State Mapper**
- `CarPlayStateMapper` - Converts MobileStateDTO → CarPlayNavSnapshot
  - Automatic coordinate conversion
  - Status line generation (distance + ETA)
  - Route readiness detection

**Key protocols:** `MobileStateDTO`: Codable, Equatable | `CarPlayNavSnapshot`: Custom Equatable

---

#### [Route.swift](ChaseMapper/Models/Route.swift) - Route Management
Request/response models and route utilities.

**Route Requests**
- `RouteRequest` - POST /api/route request
  - Convenience init: `RouteRequest(from:to:)` from CLLocationCoordinate2D
  - startLat, startLon, endLat, endLon fields

**Route Responses**
- `RouteResponse` - Complete route from POST /api/route
  - GeoJSONFeature with full route geometry
  - distanceM, durationS, provider info
  - Computed `coordinates` property → [CLLocationCoordinate2D]

**Route State**
- `RouteState` - Route information from /api/mobile_state
  - Optional geojson, distance, duration, provider
  - isEmpty computed property
  - Computed coordinates extraction

**Route Metadata**
- `RouteMetadata` - Quick access wrapper
  - Formatted distance: "12.5 km" or "500 m"
  - Formatted duration: "15 min" or "1:15"
  - Provider info, lastUpdated timestamp, isReady flag

**All models conform to:** `Codable` (except RouteMetadata), `Equatable`

---

#### [Telemetry.swift](ChaseMapper/Models/Telemetry.swift) - Real-Time Data & Analysis
Telemetry snapshots, history tracking, and coordinate mathematics.

**Telemetry Data**
- `TelemetrySnapshot` - Single telemetry update from streaming source
  - callsign, lat, lon, alt, speed, heading, timestamp
  - Validation properties: hasValidAltitude, hasValidHeading, hasValidSpeed
  - Computed `coordinate` property → CLLocationCoordinate2D

**Telemetry History**
- `TelemetryHistory` - Sliding window of recent updates (default 100 max)
  - append() - Add snapshot to history
  - latest() - Get most recent snapshot
  - all() - Get all snapshots
  - estimatedVerticalVelocity() - m/s (30 sec window)
  - estimatedGroundVelocity() - m/s (30 sec window)

**Change Detection**
- `TelemetryChangeDetector` - Significant change detection
  - Configurable thresholds (altitude, horizontal, heading, speed)
  - isSignificantChange() - Compare old vs new snapshots

- `TelemetryEvent` - Telemetry state change types
  - new, updated, significant cases

**Coordinate Extensions**
- `CLLocationCoordinate2D.distance(to:)` - Haversine distance in meters
- `CLLocationCoordinate2D.bearing(to:)` - Bearing in degrees from north

**Key protocols:** `TelemetrySnapshot`: Codable, Equatable | `TelemetryHistory`: Custom Equatable

---

### 📚 Documentation Files

#### [MODELS_INTEGRATION_GUIDE.md](MODELS_INTEGRATION_GUIDE.md)
Complete guide with code examples for integrating models into the app.

**Sections:**
- API Integration Examples (fetching state, requesting routes, error handling)
- ViewModel Integration (MapViewModel, CarPlayViewModel patterns)
- View Integration (MapView, RouteInfoView, TelemetryView examples)
- Telemetry History Tracking
- Change Detection usage
- CarPlay Action Handling
- Coordinate Mathematics
- Best Practices
- Migration from Prototype
- Troubleshooting

**Start here:** New developers should read this first

---

#### [MODELS_QUICK_REFERENCE.md](MODELS_QUICK_REFERENCE.md)
Quick lookup tables and common patterns.

**Sections:**
- File Organization table
- Common Tasks with code snippets
- Protocol Conformances table
- CodingKeys Mapping reference
- Validation Properties
- CarPlay Constraints
- Error Handling patterns
- Type Conversions
- Thread Safety notes
- Performance characteristics
- Debugging Tips

**Use for:** Quick lookups during development

---

### 🎯 Common Usage Patterns

#### Parse Mobile State Response
```swift
let decoder = JSONDecoder()
let state = try decoder.decode(MobileStateDTO.self, from: data)

// Access car position
if let car = state.car, let lat = car.lat, let lon = car.lon {
    let carCoord = CLLocationCoordinate2D(latitude: lat, longitude: lon)
}

// Access route
if let coords = state.route.geojson?.geometry.coordinates {
    let polylineCoords = coords.compactMap { pair in
        CLLocationCoordinate2D(latitude: pair[1], longitude: pair[0])
    }
}
```

#### Create Route Request
```swift
let request = RouteRequest(from: carCoord, to: targetCoord)
let encoded = try JSONEncoder().encode(request)
```

#### CarPlay Safe State
```swift
let mapper = CarPlayStateMapper()
let snapshot = mapper.makeSnapshot(from: mobileState)

// Guaranteed safe for CarPlay
let actions = CarPlayUIConstraints.allowedActions(for: snapshot)
let safeStatus = snapshot.statusLine  // Already truncated to 42 chars max
```

#### Track Telemetry
```swift
let history = TelemetryHistory()
for telemetryUpdate in liveStream {
    history.append(telemetryUpdate)
}

let verticalVelocity = history.estimatedVerticalVelocity()
let distance = history.latest()?.coordinate.distance(to: targetCoord)
```

---

### 🔗 File Cross-References

| Feature | Location | Models |
|---------|----------|--------|
| API Error Handling | DTOs.swift | ErrorDTO |
| GeoJSON Support | DTOs.swift | GeoJSONFeature, GeoJSONGeometry |
| Mobile State | MobileState.swift | MobileStateDTO |
| CarPlay UI | MobileState.swift | CarPlayNavSnapshot, CarPlayAction |
| Route Calculation | Route.swift | RouteRequest, RouteResponse |
| Route Display | Route.swift | RouteMetadata |
| Real-Time Updates | Telemetry.swift | TelemetrySnapshot |
| History Tracking | Telemetry.swift | TelemetryHistory |
| Coordinate Math | Telemetry.swift | CLLocationCoordinate2D extensions |

---

### 📊 API Endpoint Coverage

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| /api/mobile_state | GET | - | MobileStateDTO |
| /api/route | POST | RouteRequest | RouteResponseDTO |
| /api/latest_route | GET | - | GeoJSONFeature |
| All endpoints | * | - | ErrorDTO (on error) |

---

### ✅ Integration Checklist

- [ ] Read MODELS_INTEGRATION_GUIDE.md
- [ ] Update APIService to use new DTOs
- [ ] Enhance MapViewModel with mobileState property
- [ ] Create CarPlayViewModel with snapshot
- [ ] Update Map views to use route coordinates
- [ ] Add telemetry history tracking
- [ ] Add unit tests for Codable roundtrips
- [ ] Test CarPlay state mapper
- [ ] Test coordinate calculations
- [ ] Deploy and monitor

---

### 🚀 Quick Start

1. **First time?** → Read [MODELS_INTEGRATION_GUIDE.md](MODELS_INTEGRATION_GUIDE.md)
2. **Need a quick lookup?** → Check [MODELS_QUICK_REFERENCE.md](MODELS_QUICK_REFERENCE.md)
3. **Looking for a specific model?** → Search this index
4. **Integration examples?** → See [MODELS_INTEGRATION_GUIDE.md](MODELS_INTEGRATION_GUIDE.md)

---

### 📞 Support

- Models are fully documented with inline comments
- See MODELS_INTEGRATION_GUIDE.md for usage patterns
- Check MODELS_QUICK_REFERENCE.md for debugging tips
- All models compile without warnings (verified with swiftc)

---

**Last Updated:** 2024-05-21  
**Status:** ✅ Production Ready  
**Compilation:** ✅ PASS (swiftc -typecheck)
