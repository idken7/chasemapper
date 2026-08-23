# ChaseMapper iOS App

A real-time storm chase mapping application for iOS with CarPlay support.

## Requirements

- iOS 15.0+
- Xcode 14.0+
- Swift 5.9+

## Features

- **Real-time Chase Mapping**: Display live payload positions on an interactive map
- **CarPlay Support**: Safe in-vehicle access to chase data and navigation
- **Location Tracking**: Track your position during storm chasing
- **Chase Sessions**: Create and manage multiple chase sessions
- **Live Data**: Real-time updates from connected ChaseMapper backend

## Architecture

```
ChaseMapper/
├── App/                    # App entry point and scene configuration
│   ├── ChaseMapperApp.swift
│   └── CarPlaySceneDelegate.swift
├── Models/                 # Data models and DTOs
│   └── DataModels.swift
├── ViewModels/             # State management
│   ├── MapViewModel.swift
│   └── ChaseSessionViewModel.swift
├── Views/                  # UI screens
│   ├── Phone/             # iPhone views
│   │   ├── PhoneContentView.swift
│   │   ├── MapTabView.swift
│   │   ├── ChasesTabView.swift
│   │   ├── SessionDetailView.swift
│   │   └── SettingsTabView.swift
│   └── CarPlay/           # CarPlay-specific views
│       └── CarPlayViews.swift
├── Services/               # API and networking
│   ├── APIService.swift
│   └── LocationService.swift
├── Utilities/              # Helper functions
│   └── DateFormatting.swift
└── Resources/              # Assets, localization, configs
    ├── Info.plist
    ├── ChaseMapper.entitlements
    ├── Assets/
    └── Localization/
```

## Building and Running

### Using Xcode

1. Open the project in Xcode:
   ```bash
   cd ios-app
   open ChaseMapper.xcodeproj  # or use Package.swift with Xcode
   ```

2. Select the appropriate scheme and target
3. Build and run on simulator or device

### Using Swift Package Manager

```bash
cd ios-app
swift build
```

## Dependencies

- **SocketIO**: Real-time communication with ChaseMapper backend
  - Version: 16.0.0+

## Configuration

### Info.plist

The app requires the following capabilities:
- Location access (GPS)
- CarPlay support
- Maps integration

### Entitlements

CarPlay capability entitlements are configured in `ChaseMapper/Resources/ChaseMapper.entitlements`:
- CarPlay support
- Maps capability
- Application groups

## Development Notes

### Adding New Views

1. Create view files in `Views/Phone/` or `Views/CarPlay/`
2. Use `@ObservedObject` or `@StateObject` for ViewModels
3. Follow SwiftUI structure patterns

### Adding New Services

1. Create service in `Services/`
2. Implement as singleton (e.g., `static let shared`)
3. Use async/await for network operations

### State Management

- Use `@StateObject` for ViewModel ownership
- Use `@ObservedObject` for passed ViewModels
- Use `@Published` for reactive properties

## Network Configuration

The app connects to a ChaseMapper backend (default: `http://localhost:5000/api`).

To configure a different backend:
```swift
let apiService = APIService(baseURL: URL(string: "https://your-backend.com/api")!)
```

## Testing

Unit tests are located in `Tests/ChaseMapperTests/`

To run tests:
```bash
cd ios-app
swift test
```

## Roadmap

- [ ] WebSocket integration for real-time updates
- [ ] Advanced map features (overlays, drawing)
- [ ] Offline mode with cached data
- [ ] Weather integration
- [ ] Photo capture and annotation
- [ ] Share chase sessions
- [ ] Dark mode optimization
- [ ] Siri Shortcuts support

## License

See LICENSE file in parent directory

## Contributing

Contributions are welcome! Please ensure:
- Code follows Swift style guidelines
- All tests pass
- New features include tests
- Documentation is updated
