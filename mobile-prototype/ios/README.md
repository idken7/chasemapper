# iOS Native Prototype (SwiftUI)

This folder contains a minimal native iOS prototype screen that:

- Subscribes to live telemetry using Socket.IO (`telemetry_event` on namespace `/chasemapper`)
- Fetches the latest route from `GET /api/latest_route`
- Renders car marker + route polyline on a MapKit map

It also includes a CarPlay-focused constraint layer and mapping helpers:

- `CarPlay/CarPlayNavConstraints.swift`
- `CarPlay/CarPlayStateMapper.swift`
- `CarPlay/MobileStateDTO.swift`

## Requirements

- Xcode 15+
- iOS 17+
- Swift Package: `https://github.com/socketio/socket.io-client-swift`

## Quick Setup

1. Create a new iOS App project in Xcode (SwiftUI lifecycle).
2. Add Socket.IO Swift package dependency.
3. Add `App Transport Security Settings` exceptions if using non-HTTPS local endpoints.
4. Add files in this folder to your app target:
   - `ChasePrototypeScreen.swift`
   - `ChasePrototypeViewModel.swift`
   - `RouteMapView.swift`
5. Set your server URL in `ChasePrototypeViewModel`.
6. Present `ChasePrototypeScreen()` as your root view.

## Notes

- Telemetry event payload format is based on server `telemetry_event` payload.
- Route fetch expects GeoJSON `Feature` with `LineString` coordinates in `[lon, lat]` order.
- Auth is supported via `X-API-Key` header for `/api/latest_route`.
