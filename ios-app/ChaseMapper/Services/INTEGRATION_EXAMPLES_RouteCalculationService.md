# RouteCalculationService Integration Examples

## Example 1: Basic Route Computation

```swift
import CoreLocation

@MainActor
class NavigationViewController: UIViewController {
    private let routeService = RouteCalculationService()
    
    @IBAction func startNavigation() {
        guard let userLocation = locationManager.location?.coordinate,
              let targetLocation = selectedTarget else {
            showError("Missing location or target")
            return
        }
        
        computeRoute(from: userLocation, to: targetLocation)
    }
    
    private func computeRoute(from start: CLLocationCoordinate2D, to end: CLLocationCoordinate2D) {
        showLoadingSpinner()
        
        Task {
            do {
                let route = try await routeService.computeRoute(from: start, to: end)
                displayRouteOnMap(route)
                showRouteMetadata(route)
                hideLoadingSpinner()
            } catch {
                hideLoadingSpinner()
                showError("Failed to compute route: \(error.localizedDescription)")
            }
        }
    }
}
```

## Example 2: Detecting Route Deviation

```swift
@MainActor
class ChasViewModel: ObservableObject {
    private let routeService = RouteCalculationService()
    private var userLocation: CLLocationCoordinate2D?
    private var targetLocation: CLLocationCoordinate2D?
    private var currentRoute: RouteState?
    
    @Published var isOffRoute = false
    @Published var deviationMeters: CLLocationDistance = 0
    
    func updateCarPosition(_ location: CLLocationCoordinate2D) {
        userLocation = location
        checkRouteDeviation()
    }
    
    private func checkRouteDeviation() {
        guard let user = userLocation,
              let route = currentRoute,
              !route.coordinates.isEmpty else {
            isOffRoute = false
            return
        }
        
        let deviation = routeService.distanceFromRoute(
            carPosition: user,
            routeCoordinates: route.coordinates
        )
        
        deviationMeters = deviation
        
        // 60m threshold per mobile-api-contract.md
        isOffRoute = deviation >= 60
        
        if isOffRoute {
            promptRouteRecomputation()
        }
    }
    
    private func promptRouteRecomputation() {
        guard let user = userLocation, let target = targetLocation else { return }
        
        let shouldRecompute = routeService.shouldRecomputeRoute(
            previousTarget: targetLocation,
            newTarget: target,
            carPosition: user
        )
        
        if shouldRecompute {
            Task {
                await recomputeRoute(from: user, to: target)
            }
        }
    }
}
```

## Example 3: Smart Route Refresh with Debounce

```swift
@MainActor
class MapViewController: UIViewController {
    private let routeService = RouteCalculationService()
    private var currentRoute: RouteState?
    
    // User taps "Refresh Route" button
    @IBAction func refreshRoute() {
        guard let start = currentPosition, let end = targetPosition else { return }
        
        Task {
            do {
                // Debounce automatically handled by service
                // If request is within 3 seconds, cached route is returned
                let route = try await routeService.computeRoute(from: start, to: end)
                currentRoute = route
                updateMapDisplay()
            } catch let error as RouteCalculationError {
                if case .debounceActive = error {
                    showMessage("Route refresh in progress, please wait...")
                } else {
                    showError(error.errorDescription ?? "Unknown error")
                }
            } catch {
                showError("Failed to refresh route")
            }
        }
    }
}
```

## Example 4: Intelligent Route Management in MobileStateViewModel

```swift
@MainActor
final class MobileStateViewModel: ObservableObject {
    private let routeCalculationService = RouteCalculationService()
    
    @Published var route: RouteState?
    @Published var carCoordinate: CLLocationCoordinate2D?
    @Published var targetCoordinate: CLLocationCoordinate2D?
    
    private var lastTargetCoordinate: CLLocationCoordinate2D?
    
    // Called during polling update (every 2 seconds)
    private func updateMobileState(_ state: MobileStateDTO) {
        updateCarCoordinate(from: state)
        updateTargetCoordinate(from: state)
        updateRoute(from: state)
        
        // Smart recomputation check
        checkAndRecomputeRoute()
    }
    
    private func checkAndRecomputeRoute() {
        guard let targetCoord = targetCoordinate else { return }
        
        // Service implements all recompute logic
        let shouldRecompute = routeCalculationService.shouldRecomputeRoute(
            previousTarget: lastTargetCoordinate,
            newTarget: targetCoord,
            carPosition: carCoordinate
        )
        
        if shouldRecompute {
            guard let carCoord = carCoordinate else { return }
            computeRoute(from: carCoord, to: targetCoord)
        }
    }
    
    private func computeRoute(from start: CLLocationCoordinate2D, to end: CLLocationCoordinate2D) {
        routeState = .loading
        
        Task {
            do {
                let routeState = try await routeCalculationService.computeRoute(
                    from: start,
                    to: end
                )
                
                self.route = routeState
                self.lastTargetCoordinate = end
                self.routeState = .ready
                self.errorMessage = nil
            } catch {
                self.routeState = .error(formatError(error))
                self.errorMessage = "Route computation failed"
            }
        }
    }
}
```

## Example 5: Formatting Route Metadata for UI

```swift
struct RouteInfoView: View {
    let route: RouteState?
    private let routeService = RouteCalculationService()
    
    var body: some View {
        if let route = route {
            let (distStr, durStr, eta) = routeService.formatRouteMetadata(
                distance: route.distanceM,
                duration: route.durationS
            )
            
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: "location.fill")
                        .foregroundColor(.blue)
                    Text(distStr)
                        .font(.headline)
                }
                
                HStack {
                    Image(systemName: "clock.fill")
                        .foregroundColor(.orange)
                    Text(durStr)
                        .font(.headline)
                }
                
                if let eta = eta {
                    HStack {
                        Image(systemName: "calendar")
                            .foregroundColor(.green)
                        Text("Arrive: \(eta)")
                            .font(.headline)
                    }
                }
                
                Text("via \(route.provider ?? "Unknown")")
                    .font(.caption)
                    .foregroundColor(.gray)
            }
            .padding()
            .background(Color(.systemBackground))
            .cornerRadius(8)
        }
    }
}

// Usage in SwiftUI
#Preview {
    let mockRoute = RouteState(
        geojson: GeoJSONFeature(
            type: "Feature",
            geometry: GeoJSONGeometry(
                type: "LineString",
                coordinates: [[-74.0060, 40.7100], [-74.0060, 40.7150]]
            ),
            properties: nil
        ),
        distanceM: 5000,
        durationS: 600,
        provider: "OpenRouteService",
        providerBase: "osrm",
        updatedAt: ISO8601DateFormatter().string(from: Date())
    )
    
    RouteInfoView(route: mockRoute)
}
```

## Example 6: Handling Multiple Route Updates

```swift
@MainActor
class RouteManager {
    private let routeService = RouteCalculationService()
    
    // Track multiple potential targets
    var activeRoutes: [String: RouteState] = [:]
    
    func updateTargetLocation(_ callsign: String, newLocation: CLLocationCoordinate2D) {
        guard let carPosition = getCurrentCarPosition() else { return }
        
        let previousTarget = activeRoutes[callsign]?.coordinates.last
        
        // Check if we need to recompute this route
        let shouldRecompute = routeService.shouldRecomputeRoute(
            previousTarget: previousTarget,
            newTarget: newLocation,
            carPosition: carPosition
        )
        
        if shouldRecompute {
            recomputeRoute(for: callsign, from: carPosition, to: newLocation)
        }
    }
    
    private func recomputeRoute(
        for callsign: String,
        from start: CLLocationCoordinate2D,
        to end: CLLocationCoordinate2D
    ) {
        Task {
            do {
                let route = try await routeService.computeRoute(from: start, to: end)
                activeRoutes[callsign] = route
                updateUI(for: callsign)
            } catch {
                removeRoute(for: callsign)
            }
        }
    }
}
```

## Example 7: Testing the Service

```swift
import XCTest
@testable import ChaseMapper

class RouteCalculationIntegrationTests: XCTestCase {
    var viewModel: MobileStateViewModel!
    var mockAPIService: MockAPIService!
    
    override func setUp() {
        super.setUp()
        mockAPIService = MockAPIService()
        viewModel = MobileStateViewModel(
            routeCalculationService: RouteCalculationService(apiService: mockAPIService)
        )
    }
    
    func testDestinationChangeTriggersRecompute() async {
        // Setup initial route
        let target1 = CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060)
        viewModel.targetCoordinate = target1
        viewModel.carCoordinate = CLLocationCoordinate2D(latitude: 40.7100, longitude: -74.0100)
        
        // Move target by 200m
        let target2 = CLLocationCoordinate2D(latitude: 40.7143, longitude: -74.0060)
        viewModel.targetCoordinate = target2
        
        // Wait for route computation
        try? await Task.sleep(nanoseconds: 500_000_000)
        
        // Verify route state changed
        XCTAssertTrue(viewModel.routeState.isReady || viewModel.routeState.isLoading)
    }
    
    func testDebouncePreventsDuplicateRequests() async {
        let start = CLLocationCoordinate2D(latitude: 40.7100, longitude: -74.0100)
        let end = CLLocationCoordinate2D(latitude: 40.7150, longitude: -74.0050)
        
        // First request should compute
        let route1 = try? await viewModel.routeCalculationService.computeRoute(from: start, to: end)
        XCTAssertNotNil(route1)
        
        // Second request within 3 seconds should be debounced (return cached)
        let route2 = try? await viewModel.routeCalculationService.computeRoute(from: start, to: end)
        XCTAssertEqual(route1, route2)
    }
}
```

## Migration Checklist

If updating from older route logic:

- [ ] Replace direct `APIService.computeRoute()` calls with `RouteCalculationService`
- [ ] Remove manual debounce logic (now handled by service)
- [ ] Remove manual recompute trigger checks (replace with `shouldRecomputeRoute()`)
- [ ] Update error handling to use `RouteCalculationError`
- [ ] Update tests to use `RouteCalculationServiceTests` patterns
- [ ] Verify 200m/60m thresholds match your deployment
- [ ] Test debounce behavior with rapid location updates
