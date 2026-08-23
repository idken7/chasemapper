# MobileStateViewModel

The `MobileStateViewModel` is the central state management hub for the ChaseMapper iOS app. It coordinates between the APIService, SocketIOService, and all SwiftUI views to provide a single source of truth for chase navigation.

## Quick Start

```swift
@StateObject private var mobileStateVM = MobileStateViewModel()

var body: some View {
    VStack {
        if let callsign = mobileStateVM.selectedCallsign {
            Text("Tracking: \(callsign)")
        }
        
        if let target = mobileStateVM.targetCoordinate {
            Map(position: .constant(.region(/* ... */))) {
                // Display target and route
            }
        }
        
        if let error = mobileStateVM.errorMessage {
            Text("Error: \(error)").foregroundColor(.red)
            Button("Retry", action: { mobileStateVM.retryFetch() })
        }
    }
    .onAppear { mobileStateVM.start() }
    .onDisappear { mobileStateVM.stop() }
}
```

## Published Properties

### Navigation State
- **`mobileState`** - Latest comprehensive state from `/api/mobile_state` endpoint
- **`route`** - Current route geometry and metadata
- **`carCoordinate`** - Driver's vehicle position (updated from mobile_state or telemetry)
- **`targetCoordinate`** - Balloon's landing position
- **`selectedCallsign`** - Currently tracked balloon callsign

### Route Status
- **`routeState`** - Enumeration tracking route computation progress
  - `.pending` - Waiting to start
  - `.loading` - Computing route
  - `.ready` - Route available
  - `.error(String)` - Route computation failed

### Telemetry & Connection
- **`telemetry`** - Latest real-time telemetry from Socket.IO
- **`isConnected`** - API/Socket.IO connection status
- **`lastUpdateTime`** - Timestamp of last successful poll

### Error Handling
- **`errorMessage`** - User-facing error description

## Public API

### Lifecycle
```swift
func start()      // Begin polling and Socket.IO monitoring
func stop()       // Stop polling and disconnect Socket.IO
```

### User Actions
```swift
func refreshRoute()   // Manually trigger route recomputation
func retryFetch()     // Retry the last failed poll
```

## Route Recomputation

The ViewModel automatically recomputes routes when:
1. Target landing position moves > 200m (from API contract)
2. At least 30 seconds have passed since last computation

Manual recomputation can be triggered via `refreshRoute()`.

## Polling Behavior

- **Interval**: 2 seconds (when app is foreground)
- **Auto-pause**: When app backgrounded
- **Auto-resume**: When app returns to foreground
- **Error handling**: Network errors gracefully reported without crashing

## Telemetry Integration

Real-time telemetry updates flow through Socket.IO and are:
- Validated for significant changes using `TelemetryChangeDetector`
- Used to update `telemetry` and `carCoordinate` properties
- Displayed with freshness timestamp

## Error Handling

All API errors are formatted and displayed in `errorMessage`:
- Timeout errors
- Network errors
- Rate limit errors (429)
- Authorization errors (401)
- Server errors (5xx)

Users can retry via the `retryFetch()` method.

## Implementation Notes

- All state updates occur on the @MainActor for thread-safe SwiftUI binding
- Route distance calculations use the Haversine formula
- Circuit breaker and exponential backoff are delegated to APIService
- Scene phase handling supports both Phone and CarPlay scenarios
