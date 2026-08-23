# ChaseMapper iOS App - Build and Run Guide

## Prerequisites

1. **Mac with Xcode 15+**
   ```bash
   xcode-select --install
   ```

2. **iOS 15+ target device or simulator**
   - Simulator available in Xcode
   - Or iPhone/iPad running iOS 15+

3. **ChaseMapper Server**
   - Running and accessible from your network
   - Default: `http://127.0.0.1:5001`
   - Can be configured in app Settings tab

## Option 1: Build via Xcode (Recommended)

### Step 1: Open Project
```bash
cd /Users/ken/Documents/Projects/chasemapper/ios-app
open ChaseMapper.xcodeproj
```

### Step 2: Select Target
1. In Xcode, select "ChaseMapper" scheme
2. Select target device:
   - Simulator: "iPhone 15" (or other model)
   - Device: Your connected iPhone/iPad

### Step 3: Build
```bash
# In Xcode: Product → Build (⌘B)
# Or from command line:
xcodebuild build -scheme ChaseMapper -destination 'platform=iOS Simulator,name=iPhone 15'
```

### Step 4: Run
```bash
# In Xcode: Product → Run (⌘R)
# Or from command line:
xcodebuild run -scheme ChaseMapper -destination 'platform=iOS Simulator,name=iPhone 15'
```

## Option 2: Build from Command Line

### Build for Simulator
```bash
cd /Users/ken/Documents/Projects/chasemapper/ios-app
xcodebuild build \
  -scheme ChaseMapper \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  -derivedDataPath .build
```

### Build for Device
```bash
xcodebuild build \
  -scheme ChaseMapper \
  -destination 'generic/platform=iOS' \
  -derivedDataPath .build
```

### Run on Simulator
```bash
xcodebuild build \
  -scheme ChaseMapper \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  -configuration Debug
```

## Configuration

### Server URL Configuration

#### Option A: In-App Settings (Recommended)
1. Launch app
2. Go to Settings tab
3. Enter server URL (e.g., `http://192.168.1.100:5001`)
4. Tap outside field to save
5. Click "Test Connection" to verify

#### Option B: UserDefaults (Development)
```bash
# Set via command line
defaults write com.projecthorus.chasemapper serverURL "http://192.168.1.100:5001"

# Or programmatically in code
UserDefaults.standard.set("http://192.168.1.100:5001", forKey: "serverURL")
```

### API Key Configuration

#### In-App Settings
1. Go to Settings tab
2. Enter API key in "API Key" field
3. Tap outside field to save

### Typical Configuration Examples

**Local Testing:**
```
Server URL: http://127.0.0.1:5001
API Key: (leave blank if not required)
```

**Local Network Testing:**
```
Server URL: http://192.168.1.10:5001
API Key: (if your server requires it)
```

**Production:**
```
Server URL: https://chasemapper.example.com
API Key: your-api-key-here
```

## Simulator Testing

### Available Simulators
```bash
# List available simulators
xcrun simctl list devices available
```

### Create New Simulator (if needed)
```bash
xcrun simctl create "iPhone 15 Test" com.apple.CoreSimulator.SimDeviceType.iPhone-15
```

### Launch Simulator
```bash
# Automatic with xcodebuild, or manually:
open /Applications/Xcode.app/Contents/Developer/Applications/Simulator.app
```

### Simulate Location in Simulator
1. In Xcode: Debug → Simulate Location → Your Location
2. Or create GPX file for custom location

## Device Testing

### Provisioning Requirements
1. Valid Apple Developer account
2. Signing certificate
3. Device registered in Developer portal
4. Provisioning profile installed

### Connect Device
1. Plug iPhone/iPad into Mac via USB
2. Trust the device when prompted
3. Xcode should auto-discover

### Build and Install
```bash
xcodebuild build \
  -scheme ChaseMapper \
  -destination 'platform=iOS' \
  -configuration Release
```

## CarPlay Testing

### Option 1: CarPlay Simulator in Xcode
1. Edit scheme in Xcode: Product → Scheme → Edit Scheme
2. Check "Allow execution of arbitrary executables"
3. Select "CarPlay" in Simulator options
4. Run app

### Option 2: Real Car/Head Unit
1. Connect iPhone to car via USB or wireless
2. Tap "Trust" if prompted
3. Activate CarPlay
4. App should appear in CarPlay

### Debug CarPlay
```bash
# Enable console logging for CarPlay
defaults write com.apple.CoreSimulator.SimDeviceType.iPhone-CarPlay EnableLogging YES
```

## Troubleshooting

### App Won't Build
**Error: "No such module 'SocketIO'"**
- SocketIO will be resolved when dependencies are fetched
- May need to clean build folder: Xcode → Product → Clean Build Folder (⇧⌘K)

**Error: Code signing issues**
- Go to Xcode: Build Settings → Signing
- Select correct Team
- Check provisioning profile

### App Crashes on Launch
1. Check console output in Xcode: View → Debug Area → Show Console
2. Look for specific error message
3. Common issues:
   - Location permission denied
   - Server URL invalid
   - Network connectivity issues

### Connection to Server Fails
1. Verify server is running: `curl http://127.0.0.1:5001`
2. Check firewall settings
3. Verify correct URL in Settings tab
4. Check API key if required

### Maps Won't Display
1. Verify MapKit capability is enabled
2. Check location permissions in Settings app
3. Ensure target is iOS 15+
4. Try clean build (⇧⌘K then ⌘B)

### Performance Issues
1. Monitor memory in Xcode: Debug → View Memory Graph Hierarchy
2. Check CPU usage: Product → Profile
3. Profile network: Product → Profile → Network
4. Look for excessive allocations or leaks

## Development Tips

### Enable Debug Logging
Add to MobileStateViewModel or APIService:
```swift
let logger = OSLog(subsystem: "com.projecthorus.chasemapper", category: "Network")
os_log("State update: %{public}@", log: logger, type: .debug, state)
```

### Simulate Network Issues
Use Charles Proxy or Xcode's network settings:
- Throttle: Product → Scheme → Edit Scheme → Arguments → Network Link Conditioner
- Disable network: Simulator → Preferences → Network

### View Network Requests
1. Xcode: Product → Profile → Network
2. Or use Charles Proxy
3. Watch for POST /api/route and GET /api/mobile_state

### Check Map Display
Add debug annotations:
```swift
// In MapTabView
Map { ... }
.mapStyle(.standard)
.mapControls {
    MapCompass()
    MapScaleView()
}
```

## Continuous Testing

### Automated Testing
Run tests:
```bash
xcodebuild test -scheme ChaseMapper -destination 'platform=iOS Simulator,name=iPhone 15'
```

### Manual Testing Checklist
See TESTING_GUIDE.md for comprehensive test cases

## Deployment

### TestFlight
1. Archive app: Product → Build For → Archiving
2. Validate for App Store
3. Upload to TestFlight
4. Invite testers
5. Gather feedback

### App Store
1. Complete app review requirements
2. Configure App Store Connect
3. Submit for review
4. Wait for approval
5. Distribute

## Getting Help

### Check Logs
```bash
# Live system logs
log stream --predicate 'process == "ChaseMapper"'

# Past logs
log show --predicate 'process == "ChaseMapper"' --last 5h
```

### Common Sources
- Apple Developer Documentation: https://developer.apple.com/
- SwiftUI Guide: https://developer.apple.com/tutorials/swiftui
- CarPlay Guide: https://developer.apple.com/carplay/
- MapKit Documentation: https://developer.apple.com/maps/

### Debug Console Output
In Xcode: View → Debug Area → Show Console
Watch for:
- Network requests and responses
- Error messages
- State changes
- Connection events

---

**App is ready to build and run!**

Next step: `open ChaseMapper.xcodeproj` in Xcode and press ⌘R to run!
