import Foundation
import CoreLocation

/// Maps mobile_state payload into a CarPlay-safe snapshot.
/// This keeps CarPlay templates insulated from backend contract drift.
final class CarPlayStateMapper {
    func makeSnapshot(from state: MobileStateDTO) -> CarPlayNavSnapshot {
        let callsign = state.target?.callsign ?? "No target"

        let carCoord: CLLocationCoordinate2D?
        if let car = state.car, let lat = car.lat, let lon = car.lon {
            carCoord = CLLocationCoordinate2D(latitude: lat, longitude: lon)
        } else {
            carCoord = nil
        }

        let targetCoord: CLLocationCoordinate2D?
        if let target = state.target, let lat = target.landing.lat, let lon = target.landing.lon {
            targetCoord = CLLocationCoordinate2D(latitude: lat, longitude: lon)
        } else {
            targetCoord = nil
        }

        let routeReady = (state.route.geojson != nil)
        let status = buildStatusLine(state: state, routeReady: routeReady)

        return CarPlayNavSnapshot(
            callsign: callsign,
            carCoordinate: carCoord,
            targetCoordinate: targetCoord,
            routeDistanceMeters: state.route.distanceM,
            routeDurationSeconds: state.route.durationS,
            payloadTimeToLandingSeconds: state.eta.payloadTimeToLandingS,
            isRouteReady: routeReady,
            statusLine: CarPlayUiConstraints.truncateStatus(status)
        )
    }

    private func buildStatusLine(state: MobileStateDTO, routeReady: Bool) -> String {
        if !routeReady {
            return "Waiting for route"
        }

        let kmText: String
        if let m = state.route.distanceM {
            kmText = String(format: "%.1f km", m / 1000.0)
        } else {
            kmText = "-"
        }

        let etaText: String
        if let s = state.route.durationS {
            etaText = formatSeconds(s)
        } else {
            etaText = "-"
        }

        return "Route \(kmText), ETA \(etaText)"
    }

    private func formatSeconds(_ seconds: Double) -> String {
        let total = Int(seconds.rounded())
        let mins = total / 60
        let rem = total % 60
        return String(format: "%02d:%02d", mins, rem)
    }
}
