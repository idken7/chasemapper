package org.projecthorus.chasemapper.contract

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// MARK: - Common

@Serializable
data class ApiErrorResponse(
    val error: String,
    @SerialName("retry_after_s") val retryAfterS: Int? = null
)

// MARK: - /api/route (POST)

@Serializable
data class RouteRequest(
    @SerialName("start_lat") val startLat: Double,
    @SerialName("start_lon") val startLon: Double,
    @SerialName("end_lat") val endLat: Double,
    @SerialName("end_lon") val endLon: Double
)

@Serializable
data class RouteResponse(
    val feature: GeoJsonFeature,
    @SerialName("distance_m") val distanceM: Double,
    @SerialName("duration_s") val durationS: Double,
    val provider: String,
    @SerialName("provider_base") val providerBase: String
)

// MARK: - /api/latest_route (GET)

typealias LatestRouteResponse = GeoJsonFeature

// MARK: - /api/mobile_state (GET)

@Serializable
data class MobileStateResponse(
    @SerialName("server_time") val serverTime: String,
    val car: CarState? = null,
    val target: TargetState? = null,
    val route: RouteState,
    val eta: EtaState
)

@Serializable
data class CarState(
    val lat: Double? = null,
    val lon: Double? = null,
    val alt: Double? = null,
    val speed: Double? = null,
    val heading: Double? = null,
    @SerialName("heading_valid") val headingValid: Boolean = false,
    @SerialName("last_update") val lastUpdate: String? = null
)

@Serializable
data class TargetState(
    val callsign: String,
    val landing: LandingState,
    val telemetry: TelemetryState,
    @SerialName("time_to_landing") val timeToLanding: String? = null,
    @SerialName("time_to_landing_s") val timeToLandingS: Int? = null
)

@Serializable
data class LandingState(
    val lat: Double? = null,
    val lon: Double? = null,
    val alt: Double? = null
)

@Serializable
data class TelemetryState(
    val callsign: String? = null,
    val position: List<Double>? = null,
    @SerialName("vel_v") val velV: Double? = null,
    val speed: Double? = null,
    @SerialName("short_time") val shortTime: String? = null,
    @SerialName("packet_time") val packetTime: String? = null,
    @SerialName("time_to_landing") val timeToLanding: String? = null,
    @SerialName("server_time") val serverTime: Double? = null,
    val heading: Double? = null
)

@Serializable
data class RouteState(
    val geojson: GeoJsonFeature? = null,
    @SerialName("distance_m") val distanceM: Double? = null,
    @SerialName("duration_s") val durationS: Double? = null,
    val provider: String? = null,
    @SerialName("provider_base") val providerBase: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
)

@Serializable
data class EtaState(
    @SerialName("route_duration_s") val routeDurationS: Double? = null,
    @SerialName("payload_time_to_landing_s") val payloadTimeToLandingS: Int? = null,
    @SerialName("payload_time_to_landing") val payloadTimeToLanding: String? = null
)

// MARK: - GeoJSON (minimal contract shape)

@Serializable
data class GeoJsonFeature(
    val type: String,
    val geometry: GeoJsonGeometry,
    val properties: Map<String, JsonElement>? = null
)

@Serializable
data class GeoJsonGeometry(
    val type: String,
    val coordinates: List<List<Double>>
) {
    fun toLatLonPairs(): List<Pair<Double, Double>> =
        coordinates.mapNotNull { point ->
            if (point.size < 2) null else Pair(point[1], point[0])
        }
}
