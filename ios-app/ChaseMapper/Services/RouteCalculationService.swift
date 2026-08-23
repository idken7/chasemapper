import Foundation
import CoreLocation

// MARK: - Route Calculation Service

/// Service for intelligent route calculation and recomputation management.
/// Handles route computation, debouncing, and recompute trigger detection.
final class RouteCalculationService {
    // MARK: - Constants
    
    private enum Constants {
        static let destinationMovementThresholdMeters: CLLocationDistance = 200.0
        static let routeDeviationThresholdMeters: CLLocationDistance = 60.0
        static let debounceIntervalSeconds: TimeInterval = 3.0
        static let navigationProximityMeters: CLLocationDistance = 30.0
    }
    
    // MARK: - Properties
    
    private let apiService: APIService
    private var lastComputedRoute: RouteState?
    private var lastComputeTime: Date = .distantPast
    private var lastTargetCoordinate: CLLocationCoordinate2D?
    private var pendingRecomputeTask: Task<Void, Never>?
    
    // MARK: - Initialization
    
    init(apiService: APIService = APIService.shared) {
        self.apiService = apiService
    }
    
    // MARK: - Public Methods
    
    /// Determines if a route recomputation is necessary based on movement and state changes.
    ///
    /// Recompute conditions:
    /// - No usable route exists
    /// - Destination has moved >= 200m from previous target
    /// - Car deviated >= 60m from current route
    ///
    /// - Parameters:
    ///   - previousTarget: Last known target coordinate
    ///   - newTarget: Current target coordinate
    ///   - carPosition: Current car position
    /// - Returns: True if route should be recomputed
    func shouldRecomputeRoute(
        previousTarget: CLLocationCoordinate2D?,
        newTarget: CLLocationCoordinate2D,
        carPosition: CLLocationCoordinate2D?
    ) -> Bool {
        // No usable route exists
        guard let route = lastComputedRoute, !route.coordinates.isEmpty else {
            return true
        }
        
        // Destination moved >= 200m
        if let previous = previousTarget {
            let targetMovement = haversineDistance(from: previous, to: newTarget)
            if targetMovement >= Constants.destinationMovementThresholdMeters {
                return true
            }
        }
        
        // Car deviated >= 60m from route
        if let carPos = carPosition {
            let deviation = distanceFromRoute(
                carPosition: carPos,
                routeCoordinates: route.coordinates
            )
            if deviation >= Constants.routeDeviationThresholdMeters {
                return true
            }
        }
        
        return false
    }
    
    /// Computes a new route between start and end coordinates.
    ///
    /// - Parameters:
    ///   - from: Starting coordinate
    ///   - to: Ending coordinate
    /// - Returns: RouteState with computed route or throws error
    /// - Throws: APIError if route computation fails
    func computeRoute(
        from: CLLocationCoordinate2D,
        to: CLLocationCoordinate2D
    ) async throws -> RouteState {
        // Check debounce - ignore requests within 3 seconds of last compute
        let timeSinceLastCompute = Date().timeIntervalSince(lastComputeTime)
        if timeSinceLastCompute < Constants.debounceIntervalSeconds {
            // Return last known good route if available
            if let route = lastComputedRoute {
                return route
            }
            throw RouteCalculationError.debounceActive
        }
        
        do {
            let response = try await apiService.computeRoute(from: from, to: to)
            let routeState = RouteState(
                geojson: response.feature,
                distanceM: response.distanceM,
                durationS: response.durationS,
                provider: response.provider,
                providerBase: response.providerBase,
                updatedAt: ISO8601DateFormatter().string(from: Date())
            )
            
            lastComputedRoute = routeState
            lastComputeTime = Date()
            lastTargetCoordinate = to
            
            return routeState
        } catch {
            // Return last known good route if available, otherwise throw
            if let route = lastComputedRoute {
                return route
            }
            throw error
        }
    }
    
    /// Calculates the shortest distance from a point to a polyline.
    ///
    /// Uses point-to-line segment distance calculations to find the nearest point
    /// on the route polyline to the car position.
    ///
    /// - Parameters:
    ///   - carPosition: Current car position
    ///   - routeCoordinates: Array of route coordinate points
    /// - Returns: Distance in meters from car to nearest point on route
    func distanceFromRoute(
        carPosition: CLLocationCoordinate2D,
        routeCoordinates: [CLLocationCoordinate2D]
    ) -> CLLocationDistance {
        guard !routeCoordinates.isEmpty else {
            return .infinity
        }
        
        if routeCoordinates.count == 1 {
            return haversineDistance(from: carPosition, to: routeCoordinates[0])
        }
        
        var minDistance = CLLocationDistance.infinity
        
        // Check distance to each line segment
        for i in 0..<(routeCoordinates.count - 1) {
            let start = routeCoordinates[i]
            let end = routeCoordinates[i + 1]
            let distance = distanceToLineSegment(
                point: carPosition,
                segmentStart: start,
                segmentEnd: end
            )
            minDistance = min(minDistance, distance)
        }
        
        return minDistance
    }
    
    /// Formats route metadata for display.
    ///
    /// - Parameters:
    ///   - distance: Distance in meters
    ///   - duration: Duration in seconds
    /// - Returns: Formatted metadata tuple (distanceString, durationString, eta)
    func formatRouteMetadata(
        distance: Double?,
        duration: Double?
    ) -> (distanceString: String, durationString: String, eta: String?) {
        let distanceString = formatDistance(distance)
        let durationString = formatDuration(duration)
        let eta = calculateETA(duration: duration)
        
        return (distanceString, durationString, eta)
    }
    
    /// Resets the service state, useful for when canceling a route.
    func reset() {
        lastComputedRoute = nil
        lastComputeTime = .distantPast
        lastTargetCoordinate = nil
        pendingRecomputeTask?.cancel()
        pendingRecomputeTask = nil
    }
    
    // MARK: - Private Methods - Distance Calculations
    
    /// Calculates haversine distance between two coordinates.
    ///
    /// - Parameters:
    ///   - from: First coordinate
    ///   - to: Second coordinate
    /// - Returns: Distance in meters
    private func haversineDistance(
        from: CLLocationCoordinate2D,
        to: CLLocationCoordinate2D
    ) -> CLLocationDistance {
        let earthRadiusMeters: Double = 6_371_000.0
        
        let lat1Rad = from.latitude.degreesToRadians
        let lat2Rad = to.latitude.degreesToRadians
        let deltaLatRad = (to.latitude - from.latitude).degreesToRadians
        let deltaLonRad = (to.longitude - from.longitude).degreesToRadians
        
        let a = sin(deltaLatRad / 2) * sin(deltaLatRad / 2) +
                cos(lat1Rad) * cos(lat2Rad) *
                sin(deltaLonRad / 2) * sin(deltaLonRad / 2)
        
        let c = 2 * atan2(sqrt(a), sqrt(1 - a))
        
        return earthRadiusMeters * c
    }
    
    /// Calculates the shortest distance from a point to a line segment.
    ///
    /// Uses vector projection to find the closest point on the segment.
    ///
    /// - Parameters:
    ///   - point: The point to measure from
    ///   - segmentStart: Start of line segment
    ///   - segmentEnd: End of line segment
    /// - Returns: Distance in meters
    private func distanceToLineSegment(
        point: CLLocationCoordinate2D,
        segmentStart: CLLocationCoordinate2D,
        segmentEnd: CLLocationCoordinate2D
    ) -> CLLocationDistance {
        // Convert to a local coordinate system for projection calculation
        let p = (lat: point.latitude, lon: point.longitude)
        let a = (lat: segmentStart.latitude, lon: segmentStart.longitude)
        let b = (lat: segmentEnd.latitude, lon: segmentEnd.longitude)
        
        let abLat = b.lat - a.lat
        let abLon = b.lon - a.lon
        let apLat = p.lat - a.lat
        let apLon = p.lon - a.lon
        
        let abSquared = abLat * abLat + abLon * abLon
        
        // Avoid division by zero
        guard abSquared > 0 else {
            return haversineDistance(from: point, to: segmentStart)
        }
        
        let t = max(0, min(1, (apLat * abLat + apLon * abLon) / abSquared))
        
        let closestLat = a.lat + t * abLat
        let closestLon = a.lon + t * abLon
        let closest = CLLocationCoordinate2D(latitude: closestLat, longitude: closestLon)
        
        return haversineDistance(from: point, to: closest)
    }
    
    // MARK: - Private Methods - Formatting
    
    /// Formats distance in meters to a human-readable string.
    private func formatDistance(_ meters: Double?) -> String {
        guard let meters = meters else { return "--" }
        
        if meters < 1000 {
            return String(format: "%.0f m", meters)
        }
        return String(format: "%.1f km", meters / 1000.0)
    }
    
    /// Formats duration in seconds to a human-readable string.
    private func formatDuration(_ seconds: Double?) -> String {
        guard let seconds = seconds else { return "--" }
        
        let total = Int(seconds.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        
        if hours > 0 {
            return String(format: "%d:%02d h", hours, minutes)
        }
        return String(format: "%d min", minutes)
    }
    
    /// Calculates ETA as a human-readable string.
    private func calculateETA(duration: Double?) -> String? {
        guard let duration = duration else { return nil }
        
        let eta = Date().addingTimeInterval(duration)
        let dateFormatter = Foundation.DateFormatter()
        dateFormatter.dateFormat = "h:mm a"
        
        return dateFormatter.string(from: eta)
    }
}

// MARK: - Angle Extension

private extension Double {
    var degreesToRadians: Double {
        return self * .pi / 180.0
    }
}

// MARK: - Route Calculation Error

enum RouteCalculationError: LocalizedError {
    case debounceActive
    case noRouteAvailable
    case invalidCoordinates
    
    var errorDescription: String? {
        switch self {
        case .debounceActive:
            return "Route recomputation is debounced. Try again in a moment."
        case .noRouteAvailable:
            return "No route is currently available."
        case .invalidCoordinates:
            return "Invalid coordinates provided."
        }
    }
}
