# ChaseMapper iOS Services Implementation

Comprehensive API and networking service layer for ChaseMapper iOS app with production-grade resilience patterns.

## Overview

Three main service files have been created in `/ChaseMapper/Services/`:

1. **NetworkError.swift** - Error types and utilities
2. **APIService.swift** - HTTP API client with retry logic and circuit breaker
3. **SocketIOService.swift** - Real-time telemetry via Socket.IO

## NetworkError.swift

### Error Types

#### APIError Enum
Comprehensive error handling for HTTP operations with recovery suggestions:

- **invalidURL**: Malformed URL
- **requestFailed(statusCode, message)**: HTTP error with status code and message
- **decodingFailed(String)**: JSON decoding error with description
- **rateLimited(retryAfterSeconds)**: Rate limit (429) with optional Retry-After
- **circuitBreakerOpen(endpoint, resumeAt)**: Circuit breaker is open with resume time
- **networkError(String)**: Network connectivity errors
- **unauthorized**: Authentication failure (401)
- **timeout**: Request exceeded time limit
- **unknown(String)**: Generic error with description

All errors conform to `LocalizedError` and provide user-friendly descriptions and recovery suggestions.

#### SocketIOError Enum
Socket.IO specific errors:
- connectionFailed
- disconnected
- eventHandlingFailed
- messageParsingFailed
- unknown

#### RetryPolicy Struct
Configurable exponential backoff with jitter:

```swift
struct RetryPolicy {
    let maxAttempts: Int
    let initialDelaySeconds: Double
    let maxDelaySeconds: Double
    let backoffMultiplier: Double
    let jitterFraction: Double
}
```

**Pre-configured policies:**
- `.default`: 3 attempts, 1s initial, 15s max, 2x multiplier, 10% jitter
- `.aggressive`: 5 attempts, 0.5s initial, 15s max, 2x multiplier, 20% jitter

#### CircuitBreakerState Enum
Finite state machine for circuit breaker:

```swift
enum CircuitBreakerState {
    case closed           // Normal operation
    case open(resumeAt: Date)  // Paused after 5 failures
    case halfOpen         // Testing recovery
}
```

## APIService.swift

### Overview
`@MainActor` singleton providing HTTP API operations with enterprise-grade resilience.

```swift
let api = APIService.shared
api.setAPIKey("your-api-key")
```

### Configuration

```swift
init(
    baseURL: URL = URL(string: "http://localhost:5000")!,
    apiKey: String? = nil,
    retryPolicy: RetryPolicy = .default
)
```

- **Base URL**: Defaults to localhost:5000, customizable
- **API Key**: Optional, sent as `X-API-Key` header
- **Retry Policy**: Configurable with pre-built policies

### URLSession Configuration

- Request timeout: 30 seconds
- Resource timeout: 60 seconds
- Waits for connectivity: True (respects network availability)
- Cache policy: No caching (always reloads)

### Core API Methods

#### 1. Fetch Mobile State
```swift
func fetchMobileState() async throws -> MobileStateDTO
```
- **HTTP**: GET /api/mobile_state
- **Timeout**: 3 seconds
- **Returns**: Current chase state (car position, target, route, ETA)
- **Per contract**: Recommended every 2-5 seconds during active navigation

#### 2. Fetch Latest Route
```swift
func fetchLatestRoute() async throws -> GeoJSONFeature
```
- **HTTP**: GET /api/latest_route
- **Timeout**: 3 seconds
- **Returns**: GeoJSON Feature with route geometry
- **Per contract**: Only when route view becomes active or after recompute

#### 3. Compute Route
```swift
func computeRoute(
    from start: CLLocationCoordinate2D,
    to end: CLLocationCoordinate2D
) async throws -> RouteResponseDTO
```
- **HTTP**: POST /api/route
- **Timeout**: 9 seconds
- **Body**: RouteRequestDTO with coordinates
- **Returns**: RouteResponseDTO with geometry and metadata
- **Per contract**: On-demand only (start, destination changed, off-route)

### Retry Logic

**Exponential Backoff with Jitter**
- Delays: 1s, 2s, 4s, 8s (max 15s)
- Jitter: ±10% of delay prevents thundering herd
- Formula: `delay = initialDelay × multiplier^(attempt-1) + jitter`

**Retry Conditions**
- Network errors: Always retry
- 5xx errors: Retry
- 429 (Rate Limited): **Never retry** (honor Retry-After)
- 401 (Unauthorized): **Never retry**
- 400/404: **Never retry** (client error)

### Circuit Breaker

**Threshold**: 5 consecutive failures
**Behavior**: Pause requests for 30 seconds
**States**:
1. **Closed** (normal): Process all requests
2. **Open** (failed): Reject all requests, pause for 30s
3. **Half-Open** (recovery): Allow one request to test recovery

**Per endpoint tracking**: Each endpoint has independent circuit breaker state

**Thread-safe**: Uses `DispatchQueue` with barrier blocks for concurrent access

### Rate Limiting

**Response Handling**:
1. Check HTTP `Retry-After` header (seconds)
2. Check error body `retry_after_s` field
3. Throw `APIError.rateLimited(retryAfterSeconds: Int?)`

**Client responsibility**: Applications must honor rate limits and back off accordingly

### Error Handling Example

```swift
do {
    let state = try await APIService.shared.fetchMobileState()
    // Use state
} catch let error as APIError {
    switch error {
    case .rateLimited(let seconds):
        // Wait before retrying
        if let seconds = seconds {
            print("Wait \(seconds)s before retry")
        }
    case .circuitBreakerOpen(_, let resumeAt):
        print("Service paused until \(resumeAt)")
    case .timeout:
        print("Request too slow")
    case .unauthorized:
        print("Check API key")
    default:
        print(error.errorDescription)
    }
}
```

### Legacy Methods (Backward Compatible)

- `fetchPayloads() async throws -> [Payload]`
- `fetchSessions() async throws -> [ChaseSession]`
- `createSession(name:) async throws -> ChaseSession`
- `updateSessionStatus(sessionId:, status:) async throws -> ChaseSession`

## SocketIOService.swift

### Overview
`@MainActor` singleton for real-time telemetry via Socket.IO.

```swift
let socket = SocketIOService.shared
socket.connect()
```

### Published Properties

- **connectionState**: `SocketIOConnectionState` - Connection status
- **lastTelemetryEvent**: `TelemetryEvent?` - Latest telemetry snapshot
- **isConnected**: `Bool` - Quick connection check

### Connection Management

#### Connect
```swift
socket.connect()
```
- Establishes connection to `/chasemapper` namespace
- Emits `client_connected` event with client metadata
- Automatic reconnection with exponential backoff on disconnect

#### Disconnect
```swift
socket.disconnect()
```
- Graceful disconnect
- Sets manual disconnect flag (no automatic reconnection)

### Reconnection Strategy

- **Initial delay**: 5 seconds
- **Backoff**: Delay increases with each attempt
  - Attempt 1: 5s
  - Attempt 2: 10s
  - Attempt 3: 15s
  - ...
- **Max attempts**: 10
- **Jitter**: 50% randomization to prevent synchronized reconnects

### Connection State

```swift
enum SocketIOConnectionState {
    case disconnected      // Not connected
    case connecting        // Connection in progress
    case connected         // Connected and ready
    case reconnecting      // Attempting reconnection
    case failed(String)    // Connection failed
}
```

Properties:
- `isActive`: True if connecting/connected/reconnecting
- `description`: Human-readable status

### Telemetry Event Handling

**Socket.IO Event**: `telemetry_event`

**Payload Format**:
```json
{
  "callsign": "string",
  "lat": number,
  "lon": number,
  "alt": number,
  "speed": number,
  "heading": number,
  "timestamp": "ISO-8601 date string"
}
```

**Event Types**:

```swift
enum TelemetryEvent {
    case new(TelemetrySnapshot)                     // First telemetry
    case updated(old: TelemetrySnapshot, new: TelemetrySnapshot)  // Regular update
    case significant(TelemetrySnapshot)             // Significant change detected
}
```

**Change Detection** (via `TelemetryChangeDetector`):
- Altitude change ≥ 100m
- Horizontal distance ≥ 500m
- Heading change ≥ 15°
- Speed change ≥ 5 m/s
- Callsign change (always significant)

### Client Connected Event

**Emitted on connection**:
```swift
{
  "client_type": "ios",
  "timestamp": "ISO-8601 date string"
}
```

Allows server to track connected clients and coordinate updates.

### Error Handling

All errors are `LocalizedError` with descriptions:

```swift
do {
    socket.connect()
} catch let error as SocketIOError {
    print(error.errorDescription)
}
```

## Integration Example

### Complete Chase Navigation Flow

```swift
@MainActor
class ChaseLiveViewModel: ObservableObject {
    @Published var carLocation: CLLocationCoordinate2D?
    @Published var targetLocation: CLLocationCoordinate2D?
    @Published var route: RouteResponse?
    @Published var errorMessage: String?
    
    private let api = APIService.shared
    private let socket = SocketIOService.shared
    private var statePollingTask: Task<Void, Never>?
    
    func startActiveChase() {
        // 1. Connect to real-time telemetry
        socket.connect()
        
        // 2. Start polling mobile state (every 2 seconds)
        statePollingTask = Task {
            while !Task.isCancelled {
                do {
                    let state = try await api.fetchMobileState()
                    await MainActor.run {
                        self.carLocation = state.car.map {
                            CLLocationCoordinate2D(latitude: $0.lat ?? 0, longitude: $0.lon ?? 0)
                        }
                        self.targetLocation = state.target.map {
                            CLLocationCoordinate2D(latitude: $0.landing.lat ?? 0, longitude: $0.landing.lon ?? 0)
                        }
                    }
                } catch let error as APIError {
                    await MainActor.run {
                        self.errorMessage = error.errorDescription
                    }
                }
                
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
        
        // 3. Listen for real-time telemetry
        // (automatically published to socket.lastTelemetryEvent)
    }
    
    func recomputeRoute(to destination: CLLocationCoordinate2D) {
        Task {
            do {
                guard let carLoc = carLocation else { return }
                let response = try await api.computeRoute(from: carLoc, to: destination)
                await MainActor.run {
                    self.route = response
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                }
            }
        }
    }
    
    func stopChase() {
        statePollingTask?.cancel()
        socket.disconnect()
    }
}
```

### SwiftUI View Integration

```swift
@available(iOS 16.0, *)
struct ChaseLiveView: View {
    @StateObject var viewModel = ChaseLiveViewModel()
    
    var body: some View {
        VStack {
            // Status
            Text("Socket: \(viewModel.socket.connectionState.description)")
                .font(.caption)
            
            // Error message
            if let error = viewModel.errorMessage {
                Text(error)
                    .foregroundColor(.red)
            }
            
            // Latest telemetry
            if let event = viewModel.socket.lastTelemetryEvent {
                VStack {
                    Text("Target: \(event.snapshot.callsign)")
                    Text(String(format: "%.4f, %.4f", event.snapshot.lat, event.snapshot.lon))
                }
            }
            
            // Route metadata
            if let route = viewModel.route {
                VStack {
                    Text(String(format: "Distance: %.1f km", route.distanceM / 1000))
                    Text(String(format: "Duration: %.0f min", route.durationS / 60))
                }
            }
        }
        .onAppear { viewModel.startActiveChase() }
        .onDisappear { viewModel.stopChase() }
    }
}
```

## API Contract Compliance

All implementation follows [mobile-api-contract.md](../doc/mobile-api-contract.md):

✅ **Timeouts**
- GET /api/mobile_state: 3s
- GET /api/latest_route: 3s
- POST /api/route: 9s (within 8-10s spec)

✅ **Retry Logic**
- Exponential backoff with jitter (1s, 2s, 4s, 8s, max 15s)
- Respects 429 Retry-After header
- Honors 5xx retryable status codes

✅ **Circuit Breaker**
- Opens after 5 consecutive failures
- Pauses for 30 seconds
- Per-endpoint state tracking

✅ **Rate Limiting**
- Checks Retry-After header
- Checks retry_after_s in error body
- Returns APIError.rateLimited

✅ **Socket.IO**
- Connects to /chasemapper namespace
- Listens for telemetry_event
- Emits client_connected on connect
- Automatic reconnection with backoff

## Thread Safety

- **APIService**: Marked `@MainActor`, circuit breaker state uses `DispatchQueue` with barrier blocks
- **SocketIOService**: Marked `@MainActor`, publishes on main thread
- Safe for concurrent reads/writes to circuit breaker state

## Testing Recommendations

```swift
// Test retry logic
let policy = RetryPolicy(maxAttempts: 3, initialDelaySeconds: 0.1, ...)
let api = APIService(retryPolicy: policy)

// Test circuit breaker
// Simulate 5 consecutive failures → circuit opens → next request throws

// Test rate limiting
// Mock 429 response with Retry-After header

// Test Socket.IO events
// Mock telemetry_event emissions
```

## File Sizes

- NetworkError.swift: ~6 KB
- APIService.swift: ~13 KB
- SocketIOService.swift: ~8 KB
- **Total**: ~27 KB of implementation

## Dependencies

- **Foundation**: URL, URLSession, JSONEncoder/Decoder, Date
- **CoreLocation**: CLLocationCoordinate2D
- **SocketIO**: socket.io-client-swift (from Package.swift)
- **SwiftUI**: @MainActor, @Published (optional for UI integration)

## Future Enhancements

1. **Request/Response Logging**: Add debug logging with sensitive data masking
2. **Metrics**: Track request latencies, error rates, circuit breaker events
3. **Request Cancellation**: Add proper cancellation token support
4. **Mock Service**: Testing helper with predefined responses
5. **Caching**: Optional response caching for offline resilience
6. **Certificate Pinning**: For production HTTPS deployments
