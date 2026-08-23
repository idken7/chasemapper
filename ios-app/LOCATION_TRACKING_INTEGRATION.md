# Location Tracking Service Integration Guide

## Overview

The `LocationTrackingService` is a @MainActor-based service that manages GPS location tracking for the ChaseMapper iOS app. It provides real-time location updates with SwiftUI integration, permission handling, and graceful error management.

## Architecture

### Core Components

1. **LocationTrackingService** (`Services/LocationTrackingService.swift`)
   - @MainActor singleton managing all location operations
   - Published properties for SwiftUI reactivity
   - CLLocationManager delegate pattern integration
   - Configurable accuracy and distance filtering

2. **MobileStateViewModel Integration**
   - Subscribes to location updates
   - Triggers route recomputation on location changes
   - Handles location error messaging

3. **Info.plist Configuration**
   - NSLocationWhenInUseUsageDescription: Permission prompt for "While Using App"
   - NSLocationAlwaysAndWhenInUseUsageDescription: Permission prompt for "Always"

## Key Features

### Published Properties

```swift
@Published var currentLocation: CLLocationCoordinate2D?
```
Current GPS position updated in real-time.

```swift
@Published var authorizationStatus: CLAuthorizationStatus
```
Current permission status (.notDetermined, .denied, .restricted, .authorizedWhenInUse, .authorizedAlways).

```swift
@Published var locationError: String?
```
User-facing error messages for permission issues or GPS unavailability.

```swift
@Published var isTracking: Bool
```
Whether location updates are actively being received.

```swift
@Published var horizontalAccuracy: CLLocationDistance
```
Accuracy of the current location in meters.

### Public Methods

#### `start()`
Begins tracking user location. Automatically checks permissions before starting.
```swift
locationTrackingService.start()
```

#### `stop()`
Stops tracking and clears background location updates.
```swift
locationTrackingService.stop()
```

#### `requestPermission()`
Requests "When In Use" authorization from the user.
```swift
locationTrackingService.requestPermission()
```

#### `requestAlwaysPermission()`
Requests "Always" authorization (more invasive). Should only be used if app needs background tracking.
```swift
locationTrackingService.requestAlwaysPermission()
```

#### `clearError()`
Clears any displayed error messages.
```swift
locationTrackingService.clearError()
```

## Configuration

### Distance Filter
```swift
private let locationUpdateDistanceFilter: CLLocationDistance = 10
```
Only updates location if moved more than 10 meters. Reduces CPU usage and location updates.

### Desired Accuracy
```swift
private let desiredAccuracy: CLLocationAccuracy = kCLLocationAccuracyBestForNavigation
```
Uses best accuracy for navigation (±5 meters typical).

### Location Staleness Threshold
```swift
private let locationStalenessThreshold: TimeInterval = 60
```
Considers location stale after 60 seconds without updates.

### Heading Update Threshold
```swift
private let headingUpdateThreshold: CLLocationDegrees = 5
```
Only updates heading if rotated more than 5 degrees.

## Integration with MobileStateViewModel

The LocationTrackingService is automatically integrated in MobileStateViewModel:

1. **Initialization**: Service is created as a shared singleton
2. **Start/Stop**: Coordinated with ViewModel lifecycle
3. **Location Updates**: Subscribes to location changes via `startLocationUpdates()`
4. **Route Recomputation**: Triggers route recalculation when location significantly changes

### Example Usage in Views

```swift
@ObservedObject var viewModel: MobileStateViewModel
@ObservedObject var locationService = LocationTrackingService.shared

// Display current location
if let location = locationService.currentLocation {
    Text("Lat: \(location.latitude), Lon: \(location.longitude)")
}

// Show accuracy
if locationService.horizontalAccuracy >= 0 {
    Text("Accuracy: ±\(Int(locationService.horizontalAccuracy))m")
}

// Handle errors
if let error = locationService.locationError {
    Text(error).foregroundColor(.red)
}

// Request permission
Button("Enable Location") {
    locationService.requestPermission()
}
```

## Permission Handling

### Authorization States

| State | Behavior |
|-------|----------|
| `.notDetermined` | No prompt shown yet. Call `requestPermission()` to prompt. |
| `.denied` | User declined. Show settings link. Stored in `locationError`. |
| `.restricted` | System-level restriction (MDM, parental controls). |
| `.authorizedWhenInUse` | Location available while app is in foreground. |
| `.authorizedAlways` | Location available always (background too). |

### Permission Flow

1. **First Launch**: Status is `.notDetermined`
   - User sees permission prompt
   - Choose "While Using the App" or "Don't Allow"

2. **Permission Granted**: Status becomes `.authorizedWhenInUse` or `.authorizedAlways`
   - Location tracking automatically starts if requested
   - Updates flow in real-time

3. **Permission Denied**: Status becomes `.denied`
   - `locationError` displays: "Location access denied. Enable in Settings > Privacy > Location."
   - `start()` returns without tracking

4. **Permission Restricted**: Status becomes `.restricted`
   - `locationError` displays: "Location access is restricted by your device settings."

### Automatic Permission Checking

LocationTrackingService checks authorization status on initialization:
```swift
private func checkAuthorizationStatus() {
    let status = CLLocationManager.authorizationStatus()
    authorizationStatus = status
    updateErrorMessageForAuthStatus(status)
}
```

## Error Handling

The service implements comprehensive error handling:

| Error Type | Message | Recovery |
|------------|---------|----------|
| Permission Denied | "Location access denied. Enable in Settings > Privacy > Location." | Show settings link |
| Permission Restricted | "Location access is restricted by your device settings." | Device-level change needed |
| GPS Unavailable | "GPS location cannot be determined. Try moving outdoors." | User action (move outside) |
| Network Error | "Network error: Check your internet connection." | Check connectivity |
| Poor Accuracy | "GPS signal weak. Accuracy: -X meters" | Move to open area |
| Heading Failure | "Compass not available on this device." | Device limitation |

### Accuracy Filtering

Location updates are only processed if:
- Horizontal accuracy is ≥ 0 and < 200 meters
- Invalid or unreliable readings are reported as errors

## Privacy Considerations

### Location Data Management

1. **No Persistent Storage**: Location is only stored in published property while tracking
2. **Automatic Clearing**: Stop tracking to clear location in memory
3. **Sensitive Information**: Never logs actual coordinates to console
4. **User Control**: Explicit start/stop methods give user control

### Privacy Best Practices

✓ Always explain why location is needed in permission prompt (already in Info.plist)
✓ Only request "When In Use" unless "Always" is genuinely needed
✓ Stop tracking when app enters background (handled by view lifecycle)
✓ Respect user's privacy settings (check authorization before starting)
✗ Don't store raw location history
✗ Don't enable background location unless necessary

## Testing

### Unit Tests

The `LocationTrackingServiceTests.swift` includes:
- Initial state verification
- Published property reactivity
- Start/stop lifecycle
- Error clearing
- MainActor constraint validation

### Manual Testing

1. **Launch App**: Observe permission prompt
2. **Grant Permission**: Verify status updates to .authorizedWhenInUse
3. **Move Device**: Watch location update in real-time
4. **Move Indoors**: Observe accuracy decrease and error messages
5. **Go to Settings**: Disable location, return to app, verify error message
6. **Re-enable**: Verify automatic recovery when permission restored

### Testing on Different iOS Versions

- iOS 14+: Full support with all features
- iOS 13: Supported but without fullAccuracy authorization option

## Migration from LocationService

The older `LocationService` class has been superseded by `LocationTrackingService`:

| Feature | LocationService | LocationTrackingService |
|---------|-----------------|-------------------------|
| @MainActor | ✗ | ✓ |
| Error messages | ✗ | ✓ |
| Accuracy tracking | ✗ | ✓ |
| Isometric tracking | ✗ | ✓ |
| Distance filter config | ✗ | ✓ |
| Heading updates | ✗ | ✓ |
| ViewModel integration | ✗ | ✓ |

### Migration Path

Old code:
```swift
@ObservedObject var locationService = LocationService.shared
locationService.startUpdatingLocation()
```

New code:
```swift
@ObservedObject var locationService = LocationTrackingService.shared
locationService.start()
```

## Performance Considerations

### Battery Impact

- **Idle**: Minimal overhead when stopped
- **Tracking**: ~50mA typical with 10m distance filter
- **Best Accuracy**: ~80mA with kCLLocationAccuracyBestForNavigation
- **Indoor (poor signal)**: ~150mA+ (higher power GPS polling)

### Optimization Tips

1. Use larger distance filter for less critical tracking
2. Reduce desired accuracy if full precision not needed
3. Stop tracking when app backgrounded (automatic in lifecycle)
4. Implement rate limiting on route calculations

### Memory

- Negligible memory footprint
- Single published location stored (~32 bytes)
- No historical data buffered

## Troubleshooting

### "Location permission denied" Error

1. Check Info.plist for NSLocationWhenInUseUsageDescription
2. Request permission explicitly: `locationService.requestPermission()`
3. Check Settings > Privacy > Location > ChaseMapper

### No Location Updates

1. Verify `start()` was called
2. Check authorization status: should be `.authorizedWhenInUse` or `.authorizedAlways`
3. Verify GPS is available (not in buildings)
4. Check horizontalAccuracy (should be < 200m)

### High Battery Drain

1. Increase distance filter (currently 10m)
2. Reduce accuracy (use `kCLLocationAccuracyHundredMeters`)
3. Verify `stop()` is called when not needed

### Inaccurate Location

1. Move to open area (away from buildings)
2. Check horizontalAccuracy value
3. Clear any GPS cache by stopping and restarting

## Related Files

- `/ChaseMapper/Services/LocationTrackingService.swift` - Main service implementation
- `/ChaseMapper/ViewModels/MobileStateViewModel.swift` - ViewModel integration
- `/ChaseMapper/Resources/Info.plist` - Permission descriptions
- `/Tests/LocationTrackingServiceTests.swift` - Unit tests

## References

- [Apple CoreLocation Documentation](https://developer.apple.com/documentation/corelocation)
- [Apple Location Services Best Practices](https://developer.apple.com/design/human-interface-guidelines/locations)
- [Swift MainActor Documentation](https://developer.apple.com/documentation/swift/mainactor)
