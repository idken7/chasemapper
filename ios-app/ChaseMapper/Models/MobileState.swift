import Foundation
import CoreLocation

// MARK: - Mobile State DTO

/// Comprehensive state snapshot from /api/mobile_state endpoint.
/// Provides current chase status including car position, target position, route, and ETA.
struct MobileStateDTO: Codable, Equatable {
    let serverTime: String
    let car: CarDTO?
    let target: TargetDTO?
    let route: RouteDTO
    let eta: EtaDTO

    enum CodingKeys: String, CodingKey {
        case serverTime = "server_time"
        case car, target, route, eta
    }
}

// MARK: - CarPlay Navigation Snapshot

/// Driver-distraction-safe state for CarPlay templates.
/// Keeps this payload compact and avoids arbitrary free-form actions.
/// All positions are pre-converted to CLLocationCoordinate2D for direct map usage.
struct CarPlayNavSnapshot: Equatable {
    let callsign: String
    let carCoordinate: CLLocationCoordinate2D?
    let targetCoordinate: CLLocationCoordinate2D?
    let routeDistanceMeters: Double?
    let routeDurationSeconds: Double?
    let payloadTimeToLandingSeconds: Int?
    let isRouteReady: Bool
    let statusLine: String

    static func == (lhs: CarPlayNavSnapshot, rhs: CarPlayNavSnapshot) -> Bool {
        lhs.callsign == rhs.callsign &&
        lhs.carCoordinate?.latitude == rhs.carCoordinate?.latitude &&
        lhs.carCoordinate?.longitude == rhs.carCoordinate?.longitude &&
        lhs.targetCoordinate?.latitude == rhs.targetCoordinate?.latitude &&
        lhs.targetCoordinate?.longitude == rhs.targetCoordinate?.longitude &&
        lhs.routeDistanceMeters == rhs.routeDistanceMeters &&
        lhs.routeDurationSeconds == rhs.routeDurationSeconds &&
        lhs.payloadTimeToLandingSeconds == rhs.payloadTimeToLandingSeconds &&
        lhs.isRouteReady == rhs.isRouteReady &&
        lhs.statusLine == rhs.statusLine
    }
}

// MARK: - CarPlay Actions

/// Restricted set of actions allowed from CarPlay UI.
/// Keeps in-car interaction safe and focused.
enum CarPlayAction: String, CaseIterable, Codable {
    case startRoute = "start_route"
    case stopRoute = "stop_route"
    case recenterMap = "recenter_map"
    case refreshRoute = "refresh_route"
}

// MARK: - CarPlay UI Constraints

/// Hard limits aligned with conservative in-car UX patterns.
enum CarPlayUIConstraints {
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

// MARK: - CarPlay State Mapper

/// Maps mobile_state payload into a CarPlay-safe snapshot.
/// This keeps CarPlay templates insulated from backend contract drift.
/// Handles nil/empty fields gracefully and ensures all values are safe for in-car display.
final class CarPlayStateMapper {
    /// Projects mobile state to driver UI snapshot with proper nil handling and conversions.
    func makeSnapshot(from state: MobileStateDTO) -> CarPlayNavSnapshot {
        let callsign = extractCallsign(from: state)
        let carCoord = extractCarCoordinate(from: state)
        let targetCoord = extractTargetCoordinate(from: state)
        let routeReady = isRouteReady(state.route)
        let status = buildStatusLine(state: state, routeReady: routeReady)

        return CarPlayNavSnapshot(
            callsign: callsign,
            carCoordinate: carCoord,
            targetCoordinate: targetCoord,
            routeDistanceMeters: state.route.distanceM,
            routeDurationSeconds: state.route.durationS,
            payloadTimeToLandingSeconds: state.eta.payloadTimeToLandingS,
            isRouteReady: routeReady,
            statusLine: CarPlayUIConstraints.truncateStatus(status)
        )
    }

    /// Returns allowed actions for the current snapshot state.
    /// Actions depend on route readiness and vehicle state.
    func allowedActions(for snapshot: CarPlayNavSnapshot) -> [CarPlayAction] {
        if snapshot.isRouteReady {
            return [.stopRoute, .recenterMap, .refreshRoute]
        }
        return [.startRoute, .recenterMap]
    }

    // MARK: - Private Helpers

    private func extractCallsign(from state: MobileStateDTO) -> String {
        guard let target = state.target, !target.callsign.trimmingCharacters(in: .whitespaces).isEmpty else {
            return "No target"
        }
        return target.callsign
    }

    private func extractCarCoordinate(from state: MobileStateDTO) -> CLLocationCoordinate2D? {
        guard let car = state.car else { return nil }
        guard let lat = car.lat, let lon = car.lon else { return nil }
        guard CLLocationCoordinate2DIsValid(CLLocationCoordinate2D(latitude: lat, longitude: lon)) else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    private func extractTargetCoordinate(from state: MobileStateDTO) -> CLLocationCoordinate2D? {
        guard let target = state.target else { return nil }
        guard let lat = target.landing.lat, let lon = target.landing.lon else { return nil }
        guard CLLocationCoordinate2DIsValid(CLLocationCoordinate2D(latitude: lat, longitude: lon)) else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    private func isRouteReady(_ route: RouteDTO) -> Bool {
        guard let geojson = route.geojson else { return false }
        guard let geometry = geojson.geometry else { return false }
        guard let coordinates = geometry.coordinates, !coordinates.isEmpty else { return false }
        return true
    }

    private func buildStatusLine(state: MobileStateDTO, routeReady: Bool) -> String {
        // During computation - check if route distance/duration exist but geojson doesn't
        if !routeReady && (state.route.distanceM != nil || state.route.durationS != nil) {
            return "Computing route..."
        }

        if !routeReady {
            return "Waiting for route"
        }

        let kmText = formatDistance(state.route.distanceM)
        let etaText = formatDuration(state.route.durationS)

        return "Route \(kmText), ETA \(etaText)"
    }

    private func formatDistance(_ meters: Double?) -> String {
        guard let m = meters, m >= 0 else { return "-" }
        return String(format: "%.1f km", m / 1000.0)
    }

    private func formatDuration(_ seconds: Double?) -> String {
        guard let s = seconds, s >= 0 else { return "-" }
        return formatSeconds(s)
    }

    private func formatSeconds(_ seconds: Double) -> String {
        let total = Int(seconds.rounded())

        // For durations over 1 hour, show as hours if possible
        if total >= 3600 {
            let hours = total / 3600
            let remainingMins = (total % 3600) / 60
            if remainingMins == 0 {
                return "\(hours)h"
            }
            return String(format: "%dh%02d", hours, remainingMins)
        }

        // Standard MM:SS format
        let mins = total / 60
        let rem = total % 60
        return String(format: "%02d:%02d", mins, rem)
    }
}
