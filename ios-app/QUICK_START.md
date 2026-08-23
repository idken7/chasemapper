# Quick Start: ChaseMapper iOS Services

## Basic Usage

### 1. Fetch Mobile State (Every 2-5 seconds during navigation)

```swift
import SwiftUI

@MainActor
class NavigationViewModel: ObservableObject {
    @Published var carLocation: CLLocationCoordinate2D?
    @Published var targetLocation: CLLocationCoordinate2D?
    @Published var isLoading = false
    @Published var error: String?
    
    private let api = APIService.shared
    
    func startPolling() {
        Task {
            while !Task.isCancelled {
                do {
                    let state = try await api.fetchMobileState()
                    
                    if let car = state.car, let lat = car.lat, let lon = car.lon {
                        self.carLocation = CLLocationCoordinate2D(latitude: lat, longitude: lon)
                    }
                    
                    if let target = state.target,
                       let lat = target.landing.lat,
                       let lon = target.landing.lon {
                        self.targetLocation = CLLocationCoordinate2D(latitude: lat, longitude: lon)
                    }
                    
                    self.error = nil
                } catch {
                    self.error = error.localizedDescription
                }
                
                // Poll every 2 seconds
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }
}
```

### 2. Compute Route (On-demand when needed)

```swift
func recomputeRoute() {
    Task {
        do {
            guard let carLoc = carLocation,
                  let targetLoc = targetLocation else {
                return
            }
            
            let route = try await api.computeRoute(from: carLoc, to: targetLoc)
            print("Route: \(route.distanceM)m, \(route.durationS)s")
            
        } catch let error as APIError {
            switch error {
            case .rateLimited(let retryAfter):
                if let seconds = retryAfter {
                    print("Rate limited. Wait \(seconds)s")
                }
            case .circuitBreakerOpen(_, let resumeAt):
                print("Service paused until \(resumeAt)")
            default:
                print("Error: \(error.errorDescription ?? "Unknown")")
            }
        }
    }
}
```

### 3. Real-time Telemetry (Socket.IO)

```swift
@MainActor
class TelemetryViewModel: ObservableObject {
    @Published var latestCallsign = "---"
    @Published var latestLocation: CLLocationCoordinate2D?
    @Published var connectionStatus = "Disconnected"
    
    private let socket = SocketIOService.shared
    
    func startTelemetry() {
        socket.connect()
        
        // Monitor connection state
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            self.connectionStatus = self.socket.connectionState.description
            
            // React to telemetry events
            if let event = self.socket.lastTelemetryEvent {
                self.latestCallsign = event.snapshot.callsign
                self.latestLocation = event.snapshot.coordinate
                
                switch event {
                case .new(let snapshot):
                    print("New target: \(snapshot.callsign)")
                case .updated(_, let snapshot):
                    print("Target moved: \(snapshot.callsign)")
                case .significant(let snapshot):
                    print("Significant change: \(snapshot.callsign)")
                }
            }
        }
    }
    
    func stopTelemetry() {
        socket.disconnect()
    }
}
```

### 4. Error Handling

```swift
func handleAPIError(_ error: APIError) {
    switch error {
    case .invalidURL:
        showAlert("Invalid URL configuration")
        
    case .requestFailed(let code, let message):
        showAlert("Server error (\(code)): \(message)")
        
    case .decodingFailed(let reason):
        showAlert("Failed to parse response: \(reason)")
        
    case .rateLimited(let retryAfter):
        if let seconds = retryAfter {
            showAlert("Too many requests. Wait \(seconds)s")
        } else {
            showAlert("Rate limited. Please retry later")
        }
        
    case .circuitBreakerOpen(let endpoint, let resumeAt):
        showAlert("\(endpoint) service paused until \(resumeAt)")
        
    case .networkError(let reason):
        showAlert("Network error: \(reason)")
        
    case .unauthorized:
        showAlert("Authentication failed. Check API key.")
        
    case .timeout:
        showAlert("Request took too long")
        
    case .unknown(let reason):
        showAlert("Error: \(reason)")
    }
}
```

### 5. Configuration

```swift
// In app startup (e.g., SceneDelegate or @main)

import Foundation
import CoreLocation

// Configure API Service
let apiService = APIService.shared

// Set base URL (optional, defaults to http://localhost:5000)
apiService = APIService(baseURL: URL(string: "https://chasemapper.example.com")!)

// Set API key
apiService.setAPIKey("your-api-key-here")

// Socket.IO service (auto-connects to same base URL)
let socketService = SocketIOService.shared
socketService.connect()
```

## Common Patterns

### Pattern 1: Active Chase Navigation

```swift
@MainActor
class ActiveChasseViewModel: ObservableObject {
    @Published var uiState: UIState = .loading
    
    private let api = APIService.shared
    private let socket = SocketIOService.shared
    private var pollingTask: Task<Void, Never>?
    
    func startChase() {
        // 1. Connect to real-time telemetry
        socket.connect()
        
        // 2. Start polling state
        pollingTask = Task {
            while !Task.isCancelled {
                do {
                    let state = try await api.fetchMobileState()
                    await updateUI(with: state)
                } catch {
                    // Handle error
                }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }
    
    func stopChase() {
        pollingTask?.cancel()
        socket.disconnect()
    }
}
```

### Pattern 2: Automatic Route Recomputation

```swift
func setupAutoRecompute(
    targetLocation: CLLocationCoordinate2D,
    carLocation: CLLocationCoordinate2D
) {
    Task {
        while !Task.isCancelled {
            do {
                let state = try await api.fetchMobileState()
                
                // Check if we need to recompute
                let currentCar = CLLocationCoordinate2D(
                    latitude: state.car?.lat ?? 0,
                    longitude: state.car?.lon ?? 0
                )
                
                let distance = currentCar.distance(to: targetLocation)
                
                // Recompute if car is >60m off route
                if distance > 60 {
                    _ = try await api.computeRoute(from: currentCar, to: targetLocation)
                }
                
            } catch {
                print("Error: \(error)")
            }
            
            try? await Task.sleep(nanoseconds: 5_000_000_000)
        }
    }
}
```

### Pattern 3: Handle Rate Limiting

```swift
var currentBackoffEndTime: Date?

func fetchWithRateLimitHandling() {
    // Check if we need to back off
    if let endTime = currentBackoffEndTime, Date() < endTime {
        print("Still backing off until \(endTime)")
        return
    }
    
    Task {
        do {
            _ = try await api.fetchMobileState()
            currentBackoffEndTime = nil
        } catch let error as APIError {
            if case .rateLimited(let retryAfter) = error {
                if let seconds = retryAfter {
                    currentBackoffEndTime = Date().addingTimeInterval(Double(seconds))
                }
            }
        }
    }
}
```

### Pattern 4: Circuit Breaker Handling

```swift
var circuitBreakerPaused = false

func handleCircuitBreaker() {
    Task {
        do {
            _ = try await api.fetchMobileState()
            circuitBreakerPaused = false
        } catch let error as APIError {
            if case .circuitBreakerOpen(_, let resumeAt) = error {
                circuitBreakerPaused = true
                print("Service paused. Resuming at \(resumeAt)")
                
                // Wait for resume time
                let delay = resumeAt.timeIntervalSince(Date())
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                
                // Retry
                _ = try? await api.fetchMobileState()
            }
        }
    }
}
```

## Testing

### Unit Test Example

```swift
import XCTest

class APIServiceTests: XCTestCase {
    func testRetryPolicyBackoff() {
        let policy = RetryPolicy.default
        
        let delay0 = policy.delayForAttempt(1)  // ~1s
        let delay1 = policy.delayForAttempt(2)  // ~2s
        let delay2 = policy.delayForAttempt(3)  // ~4s
        
        XCTAssert(delay0 > 0.9 && delay0 < 1.1)
        XCTAssert(delay1 > 1.8 && delay1 < 2.2)
        XCTAssert(delay2 > 3.6 && delay2 < 4.4)
    }
    
    func testCircuitBreakerOpensAfterFailures() {
        let api = APIService()
        
        // Simulate 5 failures
        for _ in 0..<5 {
            api.recordFailure(for: "/api/test")
        }
        
        // Next request should throw circuitBreakerOpen
        do {
            _ = try await api.performRequest(...)
            XCTFail("Should have thrown")
        } catch let error as APIError {
            if case .circuitBreakerOpen = error {
                // Success
            } else {
                XCTFail("Wrong error type")
            }
        }
    }
}
```

## Debugging

### Enable URLSession Logging

```swift
// In AppDelegate or scene setup
URLProtocol.registerClass(RequestLoggerProtocol.self)

class RequestLoggerProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool {
        print("📤 \(request.httpMethod ?? "GET") \(request.url?.path ?? "")")
        return false
    }
}
```

### Monitor Socket.IO Events

```swift
// Add observer for connection state changes
let socket = SocketIOService.shared

Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
    print("Socket state: \(socket.connectionState)")
    print("Connected: \(socket.isConnected)")
    
    if let event = socket.lastTelemetryEvent {
        print("Latest telemetry: \(event.snapshot.callsign)")
    }
}
```

## Performance Tips

1. **Batch requests when possible** - Combine multiple small requests
2. **Respect polling intervals** - Don't poll faster than 2s for mobile_state
3. **Monitor circuit breaker** - Adjust 5-failure threshold if needed
4. **Cache responses** - App layer can cache if needed
5. **Use background polling** - Switch to 15-30s interval when in background

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Unauthorized (401)" | Check API key configuration |
| "Rate limited (429)" | Wait for Retry-After duration |
| "Circuit breaker open" | Wait 30s for automatic recovery |
| "Request timeout" | Check network connectivity |
| "Socket disconnecting" | Verify server is running |
| "Telemetry not updating" | Check server is emitting events |

---

For comprehensive documentation, see: SERVICES_IMPLEMENTATION.md
