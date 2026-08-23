# Location Tracking Service - Quick Start Guide

## For View Developers

### Display Current Location

```swift
import SwiftUI

struct MapView: View {
    @ObservedObject var locationService = LocationTrackingService.shared
    
    var body: some View {
        VStack {
            if let location = locationService.currentLocation {
                Text("📍 \(location.latitude), \(location.longitude)")
                    .font(.caption)
            }
            
            if locationService.horizontalAccuracy > 0 {
                Text("Accuracy: ±\(Int(locationService.horizontalAccuracy))m")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            
            if let error = locationService.locationError {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
            }
        }
    }
}
```

### Request Permission

```swift
Button("Enable Location Tracking") {
    LocationTrackingService.shared.requestPermission()
}
```

### Check Permission Status

```swift
@ObservedObject var locationService = LocationTrackingService.shared

switch locationService.authorizationStatus {
case .authorizedWhenInUse, .authorizedAlways:
    Text("✓ Location enabled")
case .denied:
    Text("✗ Location denied")
case .notDetermined:
    Text("? Permission required")
case .restricted:
    Text("⚠ Location restricted")
@unknown default:
    Text("?")
}
```

### Monitor Tracking Status

```swift
@ObservedObject var locationService = LocationTrackingService.shared

VStack {
    if locationService.isTracking {
        Label("Tracking active", systemImage: "location.fill")
            .foregroundColor(.green)
    } else {
        Label("Tracking inactive", systemImage: "location")
            .foregroundColor(.gray)
    }
}
```

## For ViewModel Developers

The LocationTrackingService is **already integrated** in MobileStateViewModel:

✓ Automatically starts with viewModel.start()
✓ Automatically stops with viewModel.stop()
✓ Triggers route recomputation on location changes
✓ No additional setup required!

### Access Shared Instance

```swift
let locationService = LocationTrackingService.shared

// Start tracking
locationService.start()

// Stop tracking
locationService.stop()

// Request permission
locationService.requestPermission()

// Get current location
if let location = locationService.currentLocation {
    print("Lat: \(location.latitude), Lon: \(location.longitude)")
}
```

### Subscribe to Location Changes

```swift
@ObservedObject var locationService = LocationTrackingService.shared

// Location automatically updates UI through @Published properties
var body: some View {
    Text("Location: \(locationService.currentLocation?.latitude ?? 0)")
}
```

## Common Tasks

### Start Tracking on App Launch

```swift
@main
struct ChaseMapperApp: App {
    @StateObject private var viewModel = MobileStateViewModel()
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(viewModel)
                .onAppear {
                    viewModel.start()  // Includes location tracking
                }
        }
    }
}
```

### Stop Tracking on App Background

```swift
@StateObject private var viewModel = MobileStateViewModel()
@Environment(\.scenePhase) var scenePhase

var body: some View {
    ContentView()
        .onChange(of: scenePhase) { phase in
            if phase == .background {
                viewModel.stop()
            } else if phase == .active {
                viewModel.start()
            }
        }
}
```

### Show Location Permission Prompt

```swift
struct SettingsView: View {
    @ObservedObject var locationService = LocationTrackingService.shared
    
    var body: some View {
        Form {
            Section("Location") {
                HStack {
                    Text("Status")
                    Spacer()
                    switch locationService.authorizationStatus {
                    case .authorizedWhenInUse:
                        Text("While Using App")
                            .foregroundColor(.green)
                    case .authorizedAlways:
                        Text("Always")
                            .foregroundColor(.green)
                    case .denied:
                        Text("Denied")
                            .foregroundColor(.red)
                    default:
                        Text("Not Determined")
                    }
                }
                
                if locationService.authorizationStatus == .notDetermined {
                    Button("Enable Location") {
                        locationService.requestPermission()
                    }
                }
                
                if locationService.authorizationStatus == .denied {
                    Button("Open Settings") {
                        UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!)
                    }
                }
            }
            
            if let error = locationService.locationError {
                Section {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }
        }
    }
}
```

## Configuration

To customize behavior, edit these constants in LocationTrackingService.swift:

```swift
// Distance filter: only update if moved this many meters
private let locationUpdateDistanceFilter: CLLocationDistance = 10

// Update accuracy
private let desiredAccuracy: CLLocationAccuracy = kCLLocationAccuracyBestForNavigation

// Location staleness threshold in seconds
private let locationStalenessThreshold: TimeInterval = 60

// Heading update threshold in degrees
private let headingUpdateThreshold: CLLocationDegrees = 5
```

### Accuracy Options

```swift
kCLLocationAccuracyBestForNavigation  // ±5m, high battery drain
kCLLocationAccuracyBest               // ±5m
kCLLocationAccuracyNearestTenMeters   // ±10m
kCLLocationAccuracyHundredMeters      // ±100m, low battery drain
kCLLocationAccuracyKilometer          // ±1km
kCLLocationAccuracyThreeKilometers    // ±3km
```

## Debugging

### Check Permission Status

```swift
let status = CLLocationManager.authorizationStatus()
print("Authorization: \(status.rawValue)")
// 0=notDetermined, 1=restricted, 2=denied, 3=authorizedWhenInUse, 4=authorizedAlways
```

### Monitor Location Updates

```swift
locationService.$currentLocation
    .sink { location in
        print("Location updated: \(location?.latitude ?? 0)")
    }
    .store(in: &cancellables)
```

### Check Accuracy

```swift
print("Accuracy: ±\(Int(locationService.horizontalAccuracy))m")
// < 0: Invalid
// 0-10m: Excellent (satellite locked)
// 10-50m: Very good (GPS + AGPS)
// 50-200m: Good (Cell triangulation)
// > 200m: Poor (filtering applied)
```

### View Error Messages

```swift
if let error = locationService.locationError {
    print("Location error: \(error)")
}
```

## Info.plist Permissions

Already configured:
- ✓ NSLocationWhenInUseUsageDescription
- ✓ NSLocationAlwaysAndWhenInUseUsageDescription
- ✓ UIRequiredDeviceCapabilities includes "gps"

## Testing Checklist

- [ ] App launches without crashing
- [ ] Permission prompt appears on first launch
- [ ] Granting permission enables tracking
- [ ] Location updates appear in real-time
- [ ] Stopping app stops tracking
- [ ] Returning from background resumes tracking
- [ ] Moving indoors shows accuracy decrease
- [ ] Denying permission shows error message
- [ ] Going to Settings > Privacy > Location works
- [ ] Battery drain is acceptable

## Performance Tips

1. **Increase distance filter** for less frequent updates: `locationUpdateDistanceFilter = 50`
2. **Reduce accuracy** if full precision not needed: `desiredAccuracy = kCLLocationAccuracyBestForNavigation`
3. **Stop tracking** when not needed: `locationService.stop()`
4. **Check accuracy** before relying on location: `if accuracy < 100 { ... }`

## Related Files

- Service: `/ChaseMapper/Services/LocationTrackingService.swift`
- ViewModel: `/ChaseMapper/ViewModels/MobileStateViewModel.swift`
- Tests: `/Tests/LocationTrackingServiceTests.swift`
- Guide: `/LOCATION_TRACKING_INTEGRATION.md`
- Info.plist: `/ChaseMapper/Resources/Info.plist`
