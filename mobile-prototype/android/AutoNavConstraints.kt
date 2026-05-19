package org.projecthorus.chasemapper.mobile

/**
 * Driver-distraction-safe constraints for Android Auto surfaces.
 * Keep interaction count small and avoid free-form controls while driving.
 */
object AutoNavConstraints {
    const val MAX_ACTION_STRIPS = 1
    const val MAX_ACTIONS_PER_STRIP = 3
    const val MAX_STATUS_CHARS = 42
    const val ROUTE_RECALC_DEBOUNCE_MS = 3000L

    fun truncateStatus(text: String): String {
        return if (text.length <= MAX_STATUS_CHARS) text else text.substring(0, MAX_STATUS_CHARS)
    }
}

enum class AutoNavAction {
    START_ROUTE,
    STOP_ROUTE,
    RECENTER_MAP,
    REFRESH_ROUTE
}

data class AutoNavSnapshot(
    val callsign: String,
    val carLat: Double?,
    val carLon: Double?,
    val targetLat: Double?,
    val targetLon: Double?,
    val routeDistanceMeters: Double?,
    val routeDurationSeconds: Double?,
    val payloadTimeToLandingSeconds: Int?,
    val isRouteReady: Boolean,
    val statusLine: String,
    val allowedActions: List<AutoNavAction>
)
