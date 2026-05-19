package org.projecthorus.chasemapper.mobile

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class MobileStateDto(
    @SerialName("server_time") val serverTime: String,
    val car: CarDto? = null,
    val target: TargetDto? = null,
    val route: RouteDto,
    val eta: EtaDto
)

@Serializable
data class CarDto(
    val lat: Double? = null,
    val lon: Double? = null,
    val alt: Double? = null,
    val speed: Double? = null,
    val heading: Double? = null,
    @SerialName("heading_valid") val headingValid: Boolean? = null,
    @SerialName("last_update") val lastUpdate: String? = null
)

@Serializable
data class TargetDto(
    val callsign: String,
    val landing: LandingDto,
    @SerialName("time_to_landing") val timeToLanding: String? = null,
    @SerialName("time_to_landing_s") val timeToLandingS: Int? = null
)

@Serializable
data class LandingDto(
    val lat: Double? = null,
    val lon: Double? = null,
    val alt: Double? = null
)

@Serializable
data class RouteDto(
    val geojson: JsonElement? = null,
    @SerialName("distance_m") val distanceM: Double? = null,
    @SerialName("duration_s") val durationS: Double? = null,
    val provider: String? = null,
    @SerialName("provider_base") val providerBase: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
)

@Serializable
data class EtaDto(
    @SerialName("route_duration_s") val routeDurationS: Double? = null,
    @SerialName("payload_time_to_landing_s") val payloadTimeToLandingS: Int? = null,
    @SerialName("payload_time_to_landing") val payloadTimeToLanding: String? = null
)
