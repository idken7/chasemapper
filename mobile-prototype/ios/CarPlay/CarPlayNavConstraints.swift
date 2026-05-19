import Foundation
import CoreLocation

/// Driver-distraction-safe state for CarPlay templates.
/// Keep this payload compact and avoid arbitrary free-form actions.
struct CarPlayNavSnapshot: Equatable {
    let callsign: String
    let carCoordinate: CLLocationCoordinate2D?
    let targetCoordinate: CLLocationCoordinate2D?
    let routeDistanceMeters: Double?
    let routeDurationSeconds: Double?
    let payloadTimeToLandingSeconds: Int?
    let isRouteReady: Bool
    let statusLine: String
}

enum CarPlayAction: String, CaseIterable {
    case startRoute = "start_route"
    case stopRoute = "stop_route"
    case recenterMap = "recenter_map"
    case refreshRoute = "refresh_route"
}

/// Hard limits aligned with conservative in-car UX patterns.
enum CarPlayUiConstraints {
    static let maxPrimaryButtons = 3
    static let maxStatusChars = 42
    static let routeRecalcDebounceSeconds: TimeInterval = 3.0

    static func truncateStatus(_ text: String) -> String {
        if text.count <= maxStatusChars {
            return text
        }
        let idx = text.index(text.startIndex, offsetBy: maxStatusChars)
        return String(text[..<idx])
    }

    static func allowedActions(for snapshot: CarPlayNavSnapshot) -> [CarPlayAction] {
        if snapshot.isRouteReady {
            return [.stopRoute, .recenterMap, .refreshRoute]
        }
        return [.startRoute, .recenterMap]
    }
}
