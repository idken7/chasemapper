# iOS ChaseMapper App - Testing Guide

## Setup Requirements

### Development Environment
- Xcode 15+ 
- iOS 15+ simulator or device
- ChaseMapper server running and accessible

### Initial Configuration
1. Set server URL in Settings tab (default: `http://127.0.0.1:5001`)
2. Add API key if your server requires it
3. Ensure server is properly configured and running

## Phone App Testing

### Test 1: Initial Launch and Connection
**Steps:**
1. Launch the app on simulator or device
2. Navigate to Status tab
3. Observe connection status

**Expected Results:**
- Status shows "Connected" (green) or "Disconnected" (red)
- Server URL is displayed
- Last update timestamp is shown

### Test 2: Map Display
**Steps:**
1. Go to Map tab
2. Observe the map view

**Expected Results:**
- Map loads successfully
- Shows user-friendly view of the area
- No crashes or errors in console

### Test 3: Server Data Reception
**Steps:**
1. Ensure ChaseMapper server has active balloons
2. Watch Map tab for updates
3. Check Status tab for incoming data

**Expected Results:**
- Car location marker (blue) appears when data available
- Target landing marker (red) appears for selected target
- Callsign is displayed in info panel
- Coordinates are shown and update periodically

### Test 4: Route Display
**Steps:**
1. With server running and data available
2. Observe the info panel at bottom of Map tab
3. Check for route information

**Expected Results:**
- Distance shown in km
- ETA shown in minutes
- Route polyline visible on map (blue line)
- Route details sheet accessible via info button

### Test 5: Route Refresh
**Steps:**
1. Go to Map tab
2. Click refresh button (circular arrow icon)
3. Check console for network activity

**Expected Results:**
- Route recalculates
- Info panel updates with new ETA
- No error messages displayed

### Test 6: Settings Configuration
**Steps:**
1. Go to Settings tab
2. Modify server URL
3. Click "Test Connection"
4. Modify API key if needed

**Expected Results:**
- Settings persist (saved to UserDefaults)
- Connection status updates after test
- New settings take effect on next poll

### Test 7: Status Tab Information
**Steps:**
1. Go to Status tab
2. Review all displayed information

**Expected Results:**
- Connection status is accurate
- Last update time is current
- Target information displays callsign
- Route information shows distance/duration
- Error section appears only when errors occur

### Test 8: Error Handling
**Steps:**
1. Disconnect from network or stop server
2. Observe Status tab

**Expected Results:**
- Status changes to "Disconnected" 
- Error message appears describing the issue
- No crashes - app continues running

### Test 9: Recovery from Connection Loss
**Steps:**
1. Disconnect from network
2. Wait 10 seconds
3. Reconnect to network
4. Observe app behavior

**Expected Results:**
- App automatically reconnects
- Connection status returns to "Connected"
- Data updates resume

### Test 10: Foreground/Background Behavior
**Steps:**
1. Launch app and watch data updates (every 2 seconds)
2. Press Home button to background
3. Wait 5 seconds
4. Return to app
5. Observe update frequency

**Expected Results:**
- Polling continues in foreground
- Polling stops when backgrounded
- Polling resumes when returning to foreground

## CarPlay Testing

### Prerequisites
- iPhone connected to car with CarPlay support OR
- CarPlay simulator on Mac (in Xcode)

### Test 1: CarPlay Scene Initialization
**Steps:**
1. Connect iPhone to car's CarPlay or open CarPlay simulator
2. Launch app
3. Observe CarPlay display

**Expected Results:**
- CarPlay scene appears without crashes
- Navigation template loads
- Map section is visible
- Buttons appear (Recenter, Refresh, Start/Stop)

### Test 2: Map Display on CarPlay
**Steps:**
1. Go to CarPlay map section
2. Observe map rendering

**Expected Results:**
- Map displays current location
- Car marker (blue) visible if location data available
- Target marker (red) visible if target data available

### Test 3: CarPlay Buttons
**Steps:**
1. With CarPlay active, press Recenter button
2. Press Refresh button
3. Press Start/Stop button

**Expected Results:**
- Buttons are responsive
- No crashes or hangs
- Map updates appropriately
- Status reflects changes

### Test 4: CarPlay Route Information
**Steps:**
1. With active route data
2. Check CarPlay display for:
   - Distance
   - ETA
   - Callsign

**Expected Results:**
- All information displayed clearly
- Text is readable and concise
- Updates every 2 seconds

### Test 5: CarPlay Real-time Updates
**Steps:**
1. Keep CarPlay active for 30 seconds
2. Observe information updates
3. Check polling frequency

**Expected Results:**
- Updates appear smoothly
- No lag in display updates
- Information stays current

## API Integration Testing

### Test 1: Mobile State Polling
**Verification:**
- Check Xcode console for network logs
- Verify GET requests to `/api/mobile_state` every 2 seconds
- Confirm response contains expected fields

### Test 2: Route Computation
**Verification:**
- Trigger manual route refresh from Settings
- Check console for POST request to `/api/route`
- Verify response contains distance, duration, geometry

### Test 3: Error Scenarios

**Network Timeout:**
1. Slow down network connection
2. Verify app handles 3-second timeouts gracefully

**401 Unauthorized:**
1. Use wrong API key in settings
2. Verify error message displayed
3. Confirm app doesn't crash

**429 Rate Limited:**
1. Trigger rapid refresh requests
2. Verify app respects Retry-After header
3. Confirm it backs off automatically

**500 Server Error:**
1. Configure invalid server endpoint
2. Verify circuit breaker engages after 5 failures
3. Confirm app shows "Service temporarily unavailable"

## Location Services Testing

### Test 1: Permission Prompt
**Steps:**
1. Install app fresh on device
2. Launch for first time

**Expected Results:**
- Permission prompt appears for location access
- User can grant or deny access

### Test 2: Location Updates
**Steps:**
1. Grant location permission
2. Move device around
3. Watch Map tab

**Expected Results:**
- Car location updates as device moves
- Route recalculates if threshold met (200m destination change, 60m off-route)

### Test 3: Location Unavailable
**Steps:**
1. Deny location permission
2. Try to use app

**Expected Results:**
- App continues to function
- Car location not updated (uses server-provided position if available)
- Error message in status if needed

## Performance Testing

### Test 1: Memory Usage
**Steps:**
1. Run app for 5 minutes with active data flow
2. Monitor memory in Xcode instruments

**Expected Results:**
- Memory usage stable
- No memory leaks
- Less than 100MB for normal operation

### Test 2: Network Bandwidth
**Steps:**
1. Monitor network in Xcode or system tools
2. Run app for 1 minute

**Expected Results:**
- 2s polling of mobile_state: ~5-10 KB per request
- Route requests: ~10-50 KB per request  
- Total bandwidth: ~3-5 KB/second average

### Test 3: Battery Impact
**Steps:**
1. Run app for 30 minutes
2. Monitor battery drain

**Expected Results:**
- Reasonable battery consumption
- Location tracking adds ~10-20% drain
- Polling adds ~5-10% drain

### Test 4: CPU Usage
**Steps:**
1. Observe CPU usage in Activity Monitor while app running

**Expected Results:**
- Idle CPU when not updating
- Spike during polling (< 500ms)
- Spike during route calculation
- Return to idle between updates

## Data Integrity Testing

### Test 1: Coordinate Validation
**Steps:**
1. Monitor coordinates displayed
2. Verify they're reasonable values

**Expected Results:**
- Latitude: -90 to 90
- Longitude: -180 to 180
- Not NaN or infinity values

### Test 2: Distance Calculations
**Steps:**
1. Enable developer console logging
2. Trigger route calculations
3. Review distance values

**Expected Results:**
- Distances are positive numbers
- Distances increase as target moves farther
- Distances decrease as moving toward target

### Test 3: Timestamp Accuracy
**Steps:**
1. Check timestamps in Status tab
2. Verify they match server time

**Expected Results:**
- Timestamps are recent (within 2-5 seconds)
- Timestamps increment properly
- Times match server closely

## Edge Cases

### Test 1: No Target Available
**Steps:**
1. Stop sending target data from server
2. Observe app behavior

**Expected Results:**
- "No target selected" message appears
- Map shows no target marker
- No route displayed

### Test 2: Connection Interruption Mid-request
**Steps:**
1. Simulate network interruption (disable network, use Charles proxy)
2. Observe app recovery

**Expected Results:**
- Graceful error handling
- Automatic retry after delay
- No crashes or hangs

### Test 3: Rapid Configuration Changes
**Steps:**
1. Quickly change server URL multiple times
2. Rapidly toggle API key

**Expected Results:**
- App remains responsive
- Previous requests cancelled properly
- New requests use latest config

### Test 4: Extremely Large Routes
**Steps:**
1. Create route with 1000+ waypoints
2. Observe performance

**Expected Results:**
- Route displays (may render slowly)
- No crashes
- Memory usage remains reasonable

## Troubleshooting Common Issues

### App Won't Connect
- Verify server URL in Settings
- Check server is running and accessible
- Try pinging server from terminal: `ping <hostname>`
- Verify API key if required

### Map Won't Load
- Check MapKit entitlements in project
- Verify iOS version is 15+
- Try quitting and relaunching app

### CarPlay Not Appearing
- Verify CarPlay is enabled in Xcode scheme
- Check device is properly connected to car
- Look for errors in console output

### Data Not Updating
- Check 2-second polling is happening (console logs)
- Verify server is sending data
- Check connection status in Status tab
- Look for error messages

### High Battery Drain
- Disable location services if not needed
- Check if app is stuck in infinite retry loop
- Monitor for memory leaks
- Check for excessive network activity

## Sign-off Checklist

- [ ] Phone map displays correctly
- [ ] Status information updates every 2 seconds
- [ ] Settings configuration works
- [ ] CarPlay scene appears without errors
- [ ] CarPlay buttons are responsive
- [ ] Route displays as polyline on map
- [ ] Distance and ETA are calculated correctly
- [ ] Error handling works for network failures
- [ ] App recovers from connection loss
- [ ] Location tracking works (if enabled)
- [ ] No crashes or hangs observed
- [ ] Memory usage is reasonable
- [ ] Battery impact is acceptable

All tests passed ✅ = App is ready for production use
