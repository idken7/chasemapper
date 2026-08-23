# iOS App Setup Guide

## Project Status

The iOS SwiftUI app project for ChaseMapper has been created with full support for both phone and CarPlay interfaces.

## Quick Start with Xcode

### Option 1: Using Xcode Directly (Recommended)

1. **Open the project in Xcode:**
   ```bash
   cd ios-app
   open Package.swift  # or drag the ios-app folder into Xcode
   ```

2. **In Xcode:**
   - The project will automatically open as a Swift Package
   - Select the iOS target scheme
   - Build: ⌘B
   - Run: ⌘R (on simulator or device)

### Option 2: Using Swift Package Manager from Command Line

For testing/compilation only:
```bash
cd ios-app
swift build
swift test
```

## Project Structure

```
ios-app/
├── ChaseMapper/                  # Main app source
│   ├── App/
│   │   ├── ChaseMapperApp.swift  # App entry point with scene configuration
│   │   └── CarPlaySceneDelegate.swift  # CarPlay scene management
│   │
│   ├── Models/
│   │   └── DataModels.swift      # Data structures (Location, ChaseSession, Payload)
│   │
│   ├── ViewModels/
│   │   ├── MapViewModel.swift    # Map and payload management
│   │   └── ChaseSessionViewModel.swift  # Chase session management
│   │
│   ├── Views/
│   │   ├── Phone/
│   │   │   ├── PhoneContentView.swift  # Main tab view
│   │   │   ├── MapTabView.swift        # Map display
│   │   │   ├── ChasesTabView.swift     # Chase sessions list
│   │   │   ├── SessionDetailView.swift # Session details
│   │   │   └── SettingsView.swift      # Settings
│   │   │
│   │   └── CarPlay/
│   │       └── CarPlayViews.swift  # CarPlay-specific views
│   │
│   ├── Services/
│   │   ├── APIService.swift       # Backend communication
│   │   └── LocationService.swift  # Location management
│   │
│   ├── Utilities/
│   │   └── DateFormatting.swift   # Date/JSON helpers
│   │
│   └── Resources/
│       ├── Info.plist             # App configuration
│       ├── ChaseMapper.entitlements # CarPlay entitlements
│       ├── Assets/                 # App icons, images
│       └── Localization/           # Language strings
│
├── Tests/
│   └── ChaseMapperTests/
│       └── ChaseMapperTests.swift  # Unit tests
│
├── Package.swift                  # SPM manifest
├── Package.resolved               # Dependency lock file
├── README.md                       # Detailed documentation
└── .gitignore                      # Git ignore rules
```

## Architecture

### Scene Configuration
- **iPhone**: TabView with Map, Chases, Settings tabs
- **CarPlay**: CPTemplateApplicationScene with map and chase list

### State Management
- Uses MVVM pattern with `@ObservedObject` ViewModels
- Services as singletons: `APIService.shared`, `LocationService.shared`

### Models
- **Payload**: Real-time position data (lat/lon/altitude/speed)
- **ChaseSession**: Session tracking with status and location history
- **Location**: Individual position points with metadata

### Services
- **APIService**: Async/await REST API communication
- **LocationService**: Core Location integration with delegation

## Building with Xcode

1. **Select Target:** ChaseMapper (iOS app)
2. **Select Scheme:** ChaseMapper
3. **Select Device:** Simulator or connected iOS device (iOS 15+)
4. **Build:** ⌘B or Product → Build
5. **Run:** ⌘R or Product → Run

## CarPlay Configuration

CarPlay support is configured in:
- `ChaseMapper/Resources/Info.plist` - Scene configuration
- `ChaseMapper/Resources/ChaseMapper.entitlements` - CarPlay capability
- `ChaseMapper/App/CarPlaySceneDelegate.swift` - CarPlay delegate

To enable CarPlay:
1. Set a Team ID in Xcode (Signing & Capabilities)
2. Enable CarPlay capability: +Capability → CarPlay Support

## Dependencies

### External Libraries
- **SocketIO** (16.0.0+): Real-time communication
  - WebSocket support for live updates
  - Event-based data handling

### Apple Frameworks
- **SwiftUI**: UI framework
- **MapKit**: Map visualization
- **CoreLocation**: GPS/location services
- **CarPlay**: In-vehicle interface

## Configuration

### API Endpoint
Default: `http://localhost:5000/api`

To change:
```swift
let apiService = APIService(baseURL: URL(string: "https://your-api.com/api")!)
```

### Required Permissions
- **Location**: GPS access (configured in Info.plist)
- **CarPlay**: Entitlements configuration (pre-configured)

## Next Steps

1. **Install Dependencies:**
   ```bash
   cd ios-app
   swift package resolve
   ```

2. **Run Tests:**
   ```bash
   swift test
   ```

3. **Build for Simulator:**
   In Xcode: Select "iPhone 15 Pro" simulator, ⌘B

4. **Add Real Backend:**
   - Update `APIService` baseURL
   - Implement WebSocket connection in services
   - Add authentication if needed

5. **Customize Views:**
   - Update map styling in `MapTabView.swift`
   - Add more detail views as needed
   - Customize CarPlay interface in `CarPlaySceneDelegate.swift`

## Troubleshooting

### Build Issues
- **"module not found"**: Run `swift package resolve`
- **SwiftUI errors**: Ensure iOS 15+ target
- **CarPlay errors**: Check provisioning profile and entitlements

### Runtime Issues
- **No location**: Check Location permissions in Settings
- **Map not showing**: Verify MapKit is available on device
- **CarPlay not connecting**: Ensure app is in CarPlay whitelist

## Code Examples

### Fetching Payloads
```swift
viewModel.fetchPayloads()
```

### Creating a Chase Session
```swift
sessionViewModel.createSession(name: "Storm Chase 2024")
```

### Updating Location
```swift
locationService.startUpdatingLocation()
```

## Important Notes

- Minimum deployment: iOS 15.0
- Swift version: 5.9+
- Tested frameworks: MapKit, CoreLocation, CarPlay
- App uses async/await for all async operations
- All ViewModels are `@MainActor` for thread safety

## Support

For issues or questions:
1. Check the main ChaseMapper README
2. Review inline code comments
3. Check test cases for usage examples
4. See REFACTORING.md for architecture details

---

**Last Updated:** 2024
**Status:** Ready for development
**Next Phase:** WebSocket integration for real-time updates
