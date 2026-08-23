import Foundation
import CoreLocation

#if os(iOS)
import MapKit
#endif

/// LocationTrackingService manages GPS location tracking with CoreLocation
/// - Handles location permissions (When In Use and Always)
/// - Provides real-time location updates with accuracy filtering
/// - Maintains published state for SwiftUI integration
/// - Implements graceful error handling and privacy considerations
@MainActor
final class LocationTrackingService: NSObject, ObservableObject {
    // MARK: - Published Properties
    
    /// Current GPS position
    @Published var currentLocation: CLLocationCoordinate2D?
    
    /// Current location authorization status
    @Published var authorizationStatus: CLAuthorizationStatus = .notDetermined
    
    /// User-facing error message for permission/GPS issues
    @Published var locationError: String?
    
    /// Whether location tracking is currently active
    @Published var isTracking: Bool = false
    
    /// Accuracy of the current location in meters
    @Published var horizontalAccuracy: CLLocationDistance = -1
    
    // MARK: - Configuration Constants
    
    /// Distance filter: only update if moved more than this many meters
    private let locationUpdateDistanceFilter: CLLocationDistance = 10
    
    /// Desired accuracy for location updates (best for navigation)
    private let desiredAccuracy: CLLocationAccuracy = kCLLocationAccuracyBestForNavigation
    
    /// Timeout for considering location data stale (in seconds)
    private let locationStalenessThreshold: TimeInterval = 60
    
    /// Heading update threshold in degrees
    private let headingUpdateThreshold: CLLocationDegrees = 5
    
    // MARK: - Private Properties
    
    #if os(iOS)
    private let locationManager = CLLocationManager()
    #endif
    
    private var lastLocationUpdateTime: Date?
    private var previousLocation: CLLocationCoordinate2D?
    private var startRequested = false
    
    // MARK: - Singleton
    
    static let shared = LocationTrackingService()
    
    // MARK: - Initialization
    
    override init() {
        super.init()
        setupLocationManager()
        checkAuthorizationStatus()
    }
    
    // MARK: - Public Methods
    
    /// Begin tracking user location. Requests permission first if not yet determined,
    /// and starts updating as soon as the user grants it.
    func start() {
        startRequested = true

        switch authorizationStatus {
        case .notDetermined:
            requestPermission()
            return
        case .denied, .restricted:
            locationError = "Location permission denied. Please enable location access in Settings."
            return
        default:
            break
        }

        #if os(iOS)
        locationManager.startUpdatingLocation()
        isTracking = true
        locationError = nil
        #endif
    }

    /// Stop tracking user location
    func stop() {
        startRequested = false
        #if os(iOS)
        locationManager.stopUpdatingLocation()
        #endif
        isTracking = false
    }
    
    /// Request location permission from the user
    /// Uses "When In Use" authorization by default
    func requestPermission() {
        #if os(iOS)
        locationManager.requestWhenInUseAuthorization()
        #endif
    }
    
    /// Request "Always" location authorization (more invasive)
    /// Should only be used if the app genuinely needs background location updates
    func requestAlwaysPermission() {
        #if os(iOS)
        locationManager.requestAlwaysAuthorization()
        #endif
    }
    
    /// Clear any stored location error
    func clearError() {
        locationError = nil
    }
    
    // MARK: - Private Methods
    
    #if os(iOS)
    private func setupLocationManager() {
        locationManager.delegate = self
        locationManager.desiredAccuracy = desiredAccuracy
        locationManager.distanceFilter = locationUpdateDistanceFilter
        locationManager.headingFilter = headingUpdateThreshold
    }
    
    private func checkAuthorizationStatus() {
        if #available(iOS 14.0, *) {
            authorizationStatus = locationManager.authorizationStatus
        } else {
            authorizationStatus = CLLocationManager.authorizationStatus()
        }
        updateErrorMessageForAuthStatus(authorizationStatus)
    }
    
    private var isAuthorizedForLocationTracking: Bool {
        authorizationStatus == .authorizedWhenInUse || authorizationStatus == .authorizedAlways
    }
    
    private func updateErrorMessageForAuthStatus(_ status: CLAuthorizationStatus) {
        switch status {
        case .denied:
            locationError = "Location access denied. Enable in Settings > Privacy > Location."
        case .restricted:
            locationError = "Location access is restricted by your device settings."
        case .notDetermined:
            locationError = nil
        case .authorizedWhenInUse, .authorizedAlways:
            locationError = nil
        @unknown default:
            locationError = nil
        }
    }
    
    private func isLocationStale() -> Bool {
        guard let lastUpdate = lastLocationUpdateTime else { return true }
        return Date().timeIntervalSince(lastUpdate) > locationStalenessThreshold
    }
    
    #else
    
    private func setupLocationManager() {}
    private func checkAuthorizationStatus() {}
    private var isAuthorizedForLocationTracking: Bool { true }
    private func updateErrorMessageForAuthStatus(_ status: CLAuthorizationStatus) {}
    private func isLocationStale() -> Bool { true }
    
    #endif
}

// MARK: - CLLocationManagerDelegate

#if os(iOS)
extension LocationTrackingService: CLLocationManagerDelegate {
    nonisolated func locationManager(
        _ manager: CLLocationManager,
        didChangeAuthorization status: CLAuthorizationStatus
    ) {
        Task { @MainActor in
            self.authorizationStatus = status
            self.updateErrorMessageForAuthStatus(status)

            // Auto-start tracking if a `start()` call is pending a permission decision.
            if (status == .authorizedWhenInUse || status == .authorizedAlways) && self.startRequested {
                manager.startUpdatingLocation()
                self.isTracking = true
                self.locationError = nil
            }
        }
    }
    
    nonisolated func locationManager(
        _ manager: CLLocationManager,
        didUpdateLocations locations: [CLLocation]
    ) {
        guard let location = locations.last else { return }
        
        Task { @MainActor in
            // Update location only if accuracy is reasonable
            if location.horizontalAccuracy >= 0 && location.horizontalAccuracy < 200 {
                self.currentLocation = location.coordinate
                self.horizontalAccuracy = location.horizontalAccuracy
                self.lastLocationUpdateTime = Date()
                self.previousLocation = location.coordinate
                self.locationError = nil
            } else if location.horizontalAccuracy < 0 {
                // Invalid accuracy
                self.locationError = "GPS signal weak. Accuracy: \(location.horizontalAccuracy) meters"
            }
        }
    }
    
    nonisolated func locationManager(
        _ manager: CLLocationManager,
        didFailWithError error: Error
    ) {
        Task { @MainActor in
            let locError = error as? CLError
            switch locError?.code {
            case .denied:
                self.locationError = "Location access denied"
                self.isTracking = false
                
            case .network:
                self.locationError = "Network error: Check your internet connection"
                
            case .headingFailure:
                self.locationError = "Compass not available on this device"
                
            case .locationUnknown:
                self.locationError = "GPS location cannot be determined. Try moving outdoors."
                
            default:
                self.locationError = "Location error: \(error.localizedDescription)"
            }
        }
    }
}
#endif
