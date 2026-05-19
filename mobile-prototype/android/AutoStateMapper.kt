package org.projecthorus.chasemapper.mobile

/**
 * Maps /api/mobile_state payload to Android Auto-safe UI state.
 * This avoids tying template code directly to backend JSON shape.
 */
class AutoStateMapper {
    fun toSnapshot(state: MobileStateDto): AutoNavSnapshot {
        val callsign = state.target?.callsign ?: "No target"
        val routeReady = state.route.geojson != null

        val actions = if (routeReady) {
            listOf(AutoNavAction.STOP_ROUTE, AutoNavAction.RECENTER_MAP, AutoNavAction.REFRESH_ROUTE)
        } else {
            listOf(AutoNavAction.START_ROUTE, AutoNavAction.RECENTER_MAP)
        }

        val status = buildStatus(state, routeReady)

        return AutoNavSnapshot(
            callsign = callsign,
            carLat = state.car?.lat,
            carLon = state.car?.lon,
            targetLat = state.target?.landing?.lat,
            targetLon = state.target?.landing?.lon,
            routeDistanceMeters = state.route.distanceM,
            routeDurationSeconds = state.route.durationS,
            payloadTimeToLandingSeconds = state.eta.payloadTimeToLandingS,
            isRouteReady = routeReady,
            statusLine = AutoNavConstraints.truncateStatus(status),
            allowedActions = actions
        )
    }

    private fun buildStatus(state: MobileStateDto, routeReady: Boolean): String {
        if (!routeReady) {
            return "Waiting for route"
        }

        val km = state.route.distanceM?.let { String.format("%.1f km", it / 1000.0) } ?: "-"
        val eta = state.route.durationS?.let { formatSeconds(it.toInt()) } ?: "-"
        return "Route $km, ETA $eta"
    }

    private fun formatSeconds(seconds: Int): String {
        val mins = seconds / 60
        val rem = seconds % 60
        return String.format("%02d:%02d", mins, rem)
    }
}
