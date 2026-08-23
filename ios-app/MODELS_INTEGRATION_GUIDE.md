# iOS Models Integration Guide

## Overview

This guide explains how to use the newly integrated and enhanced iOS models in the ChaseMapper app, including integration with existing ViewModels and Services.

## Model Files Structure

```
ChaseMapper/Models/
├── DataModels.swift          # Existing: Location, ChaseSession, Payload models
├── DTOs.swift               # NEW: API contract models (Codable)
├── MobileState.swift        # NEW: Mobile state and CarPlay models
├── Route.swift              # NEW: Route request/response models
└── Telemetry.swift          # NEW: Telemetry snapshots and analysis
```

## API Integration Examples

### 1. Fetching Mobile State (GET /api/mobile_state)

```swift
// In APIService or similar networking layer
func fetchMobileState() async throws -> MobileStateDTO {
    let url = baseURL.appending(path: "api/mobile_state")
    let (data, response) = try await URLSession.shared.data(from: url)
    
    guard let httpResponse = response as? HTTPURLResponse,
          httpResponse.statusCode == 200 else {
        throw NetworkError.invalidResponse
    }
    
    let decoder = JSONDecoder()
    return try decoder.decode(MobileStateDTO.self, from: data)
}
```

### 2. Requesting a Route (POST /api/route)

```swift
func requestRoute(from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) async throws -> RouteResponse {
    let request = RouteRequest(from: from, to: to)
    
    var urlRequest = URLRequest(url: baseURL.appending(path: "api/route"))
    urlRequest.httpMethod = "POST"
    urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
    
    let encoder = JSONEncoder()
    urlRequest.httpBody = try encoder.encode(request)
    
    let (data, response) = try await URLSession.shared.data(for: urlRequest)
    
    guard let httpResponse = response as? HTTPURLResponse,
          httpResponse.statusCode == 200 else {
        throw NetworkError.invalidResponse
    }
    
    let decoder = JSONDecoder()
    return try decoder.decode(RouteResponse.self, from: data)
}
```

### 3. Error Handling

```swift
// For error responses from API
func handleAPIError(data: Data) throws -> ErrorDTO {
    let decoder = JSONDecoder()
    return try decoder.decode(ErrorDTO.self, from: data)
}

// Example usage
do {
    let response = try await fetchMobileState()
} catch {
    if let errorData = data {
        if let apiError = try? handleAPIError(data: errorData) {
            print("API Error: \(apiError.error)")
            if let retryAfter = apiError.retryAfterS {
                print("Retry after \(retryAfter) seconds")
            }
        }
    }
}
```

## ViewModel Integration

### Updating MapViewModel for Mobile State

```swift
@MainActor
class MapViewModel: NSObject, ObservableObject {
    @Published var mobileState: MobileStateDTO?
    @Published var routeCoordinates: [CLLocationCoordinate2D] = []
    @Published var carPosition: CLLocationCoordinate2D?
    @Published var targetPosition: CLLocationCoordinate2D?
    
    private let apiService = APIService.shared
    
    func fetchLatestState() async {
        do {
            let state = try await apiService.fetchMobileState()
            self.mobileState = state
            
            // Extract route coordinates
            if let coords = state.route.geojson?.geometry.coordinates {
                self.routeCoordinates = coords.compactMap { pair in
                    guard pair.count >= 2 else { return nil }
                    return CLLocationCoordinate2D(latitude: pair[1], longitude: pair[0])
                }
            }
            
            // Extract positions
            if let car = state.car, let lat = car.lat, let lon = car.lon {
                self.carPosition = CLLocationCoordinate2D(latitude: lat, longitude: lon)
            }
            
            if let target = state.target, let lat = target.landing.lat, let lon = target.landing.lon {
                self.targetPosition = CLLocationCoordinate2D(latitude: lat, longitude: lon)
            }
        } catch {
            print("Error fetching mobile state: \(error)")
        }
    }
}
```

### Using CarPlay Mapper

```swift
@MainActor
class CarPlayViewModel: NSObject, ObservableObject {
    @Published var snapshot: CarPlayNavSnapshot?
    
    private let mapper = CarPlayStateMapper()
    private let apiService = APIService.shared
    
    func refreshCarPlayState() async {
        do {
            let mobileState = try await apiService.fetchMobileState()
            self.snapshot = mapper.makeSnapshot(from: mobileState)
        } catch {
            print("CarPlay state error: \(error)")
        }
    }
}
```

## View Integration Examples

### MapView with Route Display

```swift
import MapKit

struct MapView: View {
    @ObservedObject var viewModel: MapViewModel
    
    var body: some View {
        Map(position: $viewModel.position) {
            // Route polyline
            if !viewModel.routeCoordinates.isEmpty {
                MapPolyline(coordinates: viewModel.routeCoordinates)
                    .stroke(.blue, lineWidth: 3)
            }
            
            // Car position
            if let carPos = viewModel.carPosition {
                Annotation("Car", coordinate: carPos) {
                    Image(systemName: "car.fill")
                        .foregroundColor(.green)
                }
            }
            
            // Target position
            if let targetPos = viewModel.targetPosition {
                Annotation("Target", coordinate: targetPos) {
                    Image(systemName: "location.circle.fill")
                        .foregroundColor(.red)
                }
            }
        }
    }
}
```

### Route Information Display

```swift
struct RouteInfoView: View {
    let state: MobileStateDTO
    
    var body: some View {
        let metadata = RouteMetadata(from: state.route)
        
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Distance:")
                Spacer()
                Text(metadata.formattedDistance)
                    .fontWeight(.semibold)
            }
            
            HStack {
                Text("Duration:")
                Spacer()
                Text(metadata.formattedDuration)
                    .fontWeight(.semibold)
            }
            
            if let provider = metadata.provider {
                HStack {
                    Text("Provider:")
                    Spacer()
                    Text(provider)
                }
            }
            
            if let updated = metadata.lastUpdated {
                HStack {
                    Text("Updated:")
                    Spacer()
                    Text(updated.formatted())
                }
            }
        }
        .padding()
    }
}
```

### Telemetry Display

```swift
struct TelemetryView: View {
    let snapshot: TelemetrySnapshot
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Callsign: \(snapshot.callsign)")
                .font(.headline)
            
            HStack {
                Text("Position:")
                Spacer()
                Text(String(format: "%.4f, %.4f", 
                           snapshot.lat, snapshot.lon))
            }
            
            if snapshot.hasValidAltitude, let alt = snapshot.alt {
                HStack {
                    Text("Altitude:")
                    Spacer()
                    Text(String(format: "%.0f m", alt))
                }
            }
            
            if snapshot.hasValidSpeed, let speed = snapshot.speed {
                HStack {
                    Text("Speed:")
                    Spacer()
                    Text(String(format: "%.1f m/s", speed))
                }
            }
            
            if snapshot.hasValidHeading, let heading = snapshot.heading {
                HStack {
                    Text("Heading:")
                    Spacer()
                    Text(String(format: "%.0f°", heading))
                }
            }
            
            HStack {
                Text("Time:")
                Spacer()
                Text(snapshot.timestamp.formatted())
            }
        }
        .padding()
    }
}
```

## Telemetry History Tracking

```swift
@MainActor
class TelemetryViewModel: ObservableObject {
    @Published var history = TelemetryHistory(maxSize: 100)
    @Published var verticalVelocity: Double? = nil
    @Published var groundVelocity: Double? = nil
    
    func updateTelemetry(_ snapshot: TelemetrySnapshot) {
        history.append(snapshot)
        
        // Update velocity estimates
        verticalVelocity = history.estimatedVerticalVelocity()
        groundVelocity = history.estimatedGroundVelocity()
    }
}
```

## Change Detection

```swift
let detector = TelemetryChangeDetector(
    altitudeThreshold: 100,  // meters
    horizontalThreshold: 500, // meters
    headingThreshold: 15,     // degrees
    speedThreshold: 5         // m/s
)

let oldSnapshot = TelemetrySnapshot(...)
let newSnapshot = TelemetrySnapshot(...)

if detector.isSignificantChange(from: oldSnapshot, to: newSnapshot) {
    // Alert user or update UI significantly
}
```

## CarPlay Integration

### Safe Action Handling

```swift
func handleCarPlayAction(_ action: CarPlayAction, snapshot: CarPlayNavSnapshot) {
    let allowedActions = CarPlayUIConstraints.allowedActions(for: snapshot)
    
    guard allowedActions.contains(action) else {
        print("Action not allowed in current state")
        return
    }
    
    switch action {
    case .startRoute:
        initiateRouteNavigation()
    case .stopRoute:
        cancelRouteNavigation()
    case .recenterMap:
        recenterMapOnCar()
    case .refreshRoute:
        refreshRouteData()
    }
}
```

### Safe Status Display

```swift
let truncatedStatus = CarPlayUIConstraints.truncateStatus(
    "Route 12.5 km, ETA 15:30"  // Guaranteed ≤ 42 chars
)
```

## Coordinate Mathematics

```swift
// Distance between two coordinates
let car = CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194)
let target = CLLocationCoordinate2D(latitude: 37.8044, longitude: -122.2712)
let distanceMeters = car.distance(to: target)

// Bearing from car to target
let bearingDegrees = car.bearing(to: target)
```

## Best Practices

1. **Always use DTOs for API boundaries** - Keep API contracts separate from domain models
2. **Validate coordinates** - Use the `hasValid*` properties on TelemetrySnapshot
3. **Handle optionals gracefully** - Most fields are optional for partial API responses
4. **Use CarPlay mappers** - Never pass full MobileStateDTO to CarPlay; use CarPlayStateMapper
5. **Monitor telemetry changes** - Use TelemetryChangeDetector for significant events
6. **Format UI strings** - Use RouteMetadata and CarPlayUIConstraints for safe display

## Migration from Prototype

If you have existing code using the prototype models:

```swift
// Old (prototype)
// import from mobile-prototype/ios/CarPlay/MobileStateDTO.swift

// New (integrated)
// import from ChaseMapper/Models/MobileState.swift
// All functionality preserved and enhanced
```

## Troubleshooting

### Codable Errors

Ensure JSON keys match snake_case format:
```json
{
  "server_time": "2024-01-15T12:00:00Z",
  "car": {
    "lat": 37.7749,
    "lon": -122.4194,
    "heading_valid": true
  }
}
```

### CLLocationCoordinate2D Comparisons

Remember that CLLocationCoordinate2D is not Equatable. Use:
```swift
snapshot1.carCoordinate?.latitude == snapshot2.carCoordinate?.latitude &&
snapshot1.carCoordinate?.longitude == snapshot2.carCoordinate?.longitude
```

Or use CarPlayNavSnapshot.== which handles this automatically.
