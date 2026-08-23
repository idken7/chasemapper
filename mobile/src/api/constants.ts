// Mirrors doc/mobile-api-contract.md's recommended cadence/timeout/backoff values.

export const MOBILE_STATE_TIMEOUT_MS = 3000;
export const ROUTE_TIMEOUT_MS = 9000;
export const LATEST_ROUTE_TIMEOUT_MS = 3000;
// Full-history payload (up to 20k path points per tracked callsign) — needs more room
// than the compact mobile_state poll.
export const TELEMETRY_ARCHIVE_TIMEOUT_MS = 8000;

export const MOBILE_STATE_POLL_ACTIVE_MS = 2000; // foreground + active chase navigation
export const MOBILE_STATE_POLL_PASSIVE_MS = 5000; // foreground + map open but passive
export const MOBILE_STATE_POLL_BACKGROUND_MS = 20000; // background / low-power (15-30s range)

// How often an active route is recomputed against the target's latest position — the
// server never recomputes this on its own, so without a periodic refresh the drawn
// route silently goes stale (still road-accurate, just to wherever the balloon was
// when "Start Routing" was tapped) as it keeps moving.
export const ROUTE_AUTO_REFRESH_MS = 20000;

export const RETRY_BASE_DELAY_MS = 1000;
export const RETRY_MAX_DELAY_MS = 15000;
export const RETRY_MAX_ATTEMPTS = 4; // yields delays 1s, 2s, 4s, 8s (capped at 15s)

export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
export const CIRCUIT_BREAKER_PAUSE_MS = 30000;

// Device-position emit throttling — stays well under the server's ~120/min per-client_id
// rate limit (see location/useLocationSharing.ts, wired up in Phase 5).
export const DEVICE_POSITION_FOREGROUND_INTERVAL_MS = 4000;
export const DEVICE_POSITION_BACKGROUND_INTERVAL_MS = 20000;
