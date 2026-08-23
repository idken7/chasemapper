import Foundation
import CoreLocation

// MARK: - Telemetry Snapshot

/// A single telemetry update from streaming or polling sources.
/// Represents the most recent known position and state of a payload (e.g., balloon, drone).
struct TelemetrySnapshot: Codable, Equatable {
    let callsign: String
    let lat: Double
    let lon: Double
    let alt: Double?
    let speed: Double?
    let heading: Double?
    let timestamp: Date

    enum CodingKeys: String, CodingKey {
        case callsign
        case lat, lon, alt
        case speed, heading, timestamp
    }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    var hasValidAltitude: Bool {
        alt != nil && alt.map { !$0.isNaN } ?? false
    }

    var hasValidHeading: Bool {
        heading != nil && heading.map { !$0.isNaN && $0 >= 0 && $0 < 360 } ?? false
    }

    var hasValidSpeed: Bool {
        speed != nil && speed.map { !$0.isNaN && $0 >= 0 } ?? false
    }
}

// MARK: - Telemetry History

/// Maintains a sliding window of recent telemetry updates.
/// Useful for velocity and heading trend calculations.
final class TelemetryHistory: Equatable {
    private var snapshots: [TelemetrySnapshot] = []
    private let maxSize: Int

    init(maxSize: Int = 100) {
        self.maxSize = maxSize
    }

    func append(_ snapshot: TelemetrySnapshot) {
        snapshots.append(snapshot)
        if snapshots.count > maxSize {
            snapshots.removeFirst()
        }
    }

    func latest() -> TelemetrySnapshot? {
        snapshots.last
    }

    func all() -> [TelemetrySnapshot] {
        snapshots
    }

    func clear() {
        snapshots.removeAll()
    }

    var count: Int {
        snapshots.count
    }

    // Estimate vertical velocity (m/s) from recent samples
    func estimatedVerticalVelocity(timeWindowSeconds: TimeInterval = 30) -> Double? {
        let now = Date()
        let recentSnapshots = snapshots.filter { now.timeIntervalSince($0.timestamp) <= timeWindowSeconds }
        guard recentSnapshots.count >= 2 else { return nil }

        let first = recentSnapshots.first!
        let last = recentSnapshots.last!
        guard let alt1 = first.alt, let alt2 = last.alt else { return nil }

        let timeDiff = last.timestamp.timeIntervalSince(first.timestamp)
        guard timeDiff > 0 else { return nil }

        return (alt2 - alt1) / timeDiff
    }

    // Estimate ground velocity (m/s) from recent samples
    func estimatedGroundVelocity(timeWindowSeconds: TimeInterval = 30) -> Double? {
        let now = Date()
        let recentSnapshots = snapshots.filter { now.timeIntervalSince($0.timestamp) <= timeWindowSeconds }
        guard recentSnapshots.count >= 2 else { return nil }

        let first = recentSnapshots.first!
        let last = recentSnapshots.last!

        let coord1 = first.coordinate
        let coord2 = last.coordinate

        let distance = coord1.distance(to: coord2)
        let timeDiff = last.timestamp.timeIntervalSince(first.timestamp)
        guard timeDiff > 0 else { return nil }

        return distance / timeDiff
    }

    static func == (lhs: TelemetryHistory, rhs: TelemetryHistory) -> Bool {
        lhs.snapshots == rhs.snapshots
    }
}

// MARK: - CLLocationCoordinate2D Distance Extension

extension CLLocationCoordinate2D {
    /// Approximate distance to another coordinate in meters.
    /// Uses simplified Haversine formula.
    func distance(to other: CLLocationCoordinate2D) -> Double {
        let earthRadiusMeters = 6_371_000.0

        let lat1Rad = latitude * .pi / 180.0
        let lat2Rad = other.latitude * .pi / 180.0
        let deltaLatRad = (other.latitude - latitude) * .pi / 180.0
        let deltaLonRad = (other.longitude - longitude) * .pi / 180.0

        let a = sin(deltaLatRad / 2.0) * sin(deltaLatRad / 2.0) +
                cos(lat1Rad) * cos(lat2Rad) *
                sin(deltaLonRad / 2.0) * sin(deltaLonRad / 2.0)

        let c = 2.0 * atan2(sqrt(a), sqrt(1.0 - a))

        return earthRadiusMeters * c
    }

    /// Bearing (degrees from north) to another coordinate.
    func bearing(to other: CLLocationCoordinate2D) -> Double {
        let lat1Rad = latitude * .pi / 180.0
        let lat2Rad = other.latitude * .pi / 180.0
        let deltaLonRad = (other.longitude - longitude) * .pi / 180.0

        let y = sin(deltaLonRad) * cos(lat2Rad)
        let x = cos(lat1Rad) * sin(lat2Rad) - sin(lat1Rad) * cos(lat2Rad) * cos(deltaLonRad)

        let bearingRad = atan2(y, x)
        var bearingDeg = bearingRad * 180.0 / .pi

        bearingDeg = fmod(bearingDeg + 360.0, 360.0)

        return bearingDeg
    }
}

// MARK: - Telemetry Event

/// Represents a telemetry state change or significant event.
enum TelemetryEvent {
    case new(TelemetrySnapshot)
    case updated(old: TelemetrySnapshot, new: TelemetrySnapshot)
    case significant(TelemetrySnapshot) // Significant change detected

    var snapshot: TelemetrySnapshot {
        switch self {
        case .new(let snapshot), .updated(_, let snapshot), .significant(let snapshot):
            return snapshot
        }
    }
}

// MARK: - Telemetry Change Detection

/// Determines if a telemetry update represents a significant change.
final class TelemetryChangeDetector {
    private let altitudeThresholdMeters: Double
    private let horizontalThresholdMeters: Double
    private let headingThresholdDegrees: Double
    private let speedThresholdMps: Double

    init(
        altitudeThreshold: Double = 100,
        horizontalThreshold: Double = 500,
        headingThreshold: Double = 15,
        speedThreshold: Double = 5
    ) {
        self.altitudeThresholdMeters = altitudeThreshold
        self.horizontalThresholdMeters = horizontalThreshold
        self.headingThresholdDegrees = headingThreshold
        self.speedThresholdMps = speedThreshold
    }

    func isSignificantChange(from old: TelemetrySnapshot, to new: TelemetrySnapshot) -> Bool {
        if old.callsign != new.callsign {
            return true
        }

        // Check altitude change
        if let oldAlt = old.alt, let newAlt = new.alt {
            if abs(newAlt - oldAlt) >= altitudeThresholdMeters {
                return true
            }
        }

        // Check horizontal distance
        let distance = old.coordinate.distance(to: new.coordinate)
        if distance >= horizontalThresholdMeters {
            return true
        }

        // Check heading change
        if let oldHeading = old.heading, let newHeading = new.heading {
            let headingDiff = abs(newHeading - oldHeading)
            if headingDiff >= headingThresholdDegrees && headingDiff <= (360 - headingThresholdDegrees) {
                return true
            }
        }

        // Check speed change
        if let oldSpeed = old.speed, let newSpeed = new.speed {
            if abs(newSpeed - oldSpeed) >= speedThresholdMps {
                return true
            }
        }

        return false
    }
}
