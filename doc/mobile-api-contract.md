# Chasemapper Mobile API Contract

This document defines the mobile-facing API contract for route and chase-state consumption.

- Version: `v1`
- Transport: HTTPS + JSON (`application/json`)
- Auth: `X-API-Key` header (recommended for internet-exposed deployments) - see [Authentication](#authentication)
- Time format: ISO-8601 UTC strings

## Authentication

When the server has an API key configured (`CHASEMAPPER_API_KEY`), these are all covered by the same key policy (`CHASEMAPPER_REQUIRE_API_AUTH`: `auto` exempts private-network client IPs, `true` requires the key from everyone) and the same per-IP rate limiting:

- `POST /api/route`, `GET|POST /api/latest_route`, `GET /api/mobile_state`
- `POST /api/device_position`
- `GET /get_config`, `GET /get_telemetry_archive`, `GET /get_bearings`
- The Socket.IO connection to the `/chasemapper` namespace

REST requests send the key as an `X-API-Key` header (an `api_key` query parameter is also accepted). The Socket.IO connection sends it once, as an `api_key` query parameter on the connection URL. A missing or wrong key gets `401 {"error": "unauthorized"}` on REST, and a refused connection on Socket.IO.

## Base Behavior

- Success codes: `200`
- Client errors: `400`, `401`, `404`, `409`, `429`
- Server/upstream errors: `500`, `502`

Common error payload shape:

```json
{
  "error": "string",
  "retry_after_s": 12
}
```

`retry_after_s` is present for `429` rate-limit responses.

`409` is only returned by `POST /api/device_position`, when another live connection currently owns that `client_id`'s car (see below).

## JSON Schemas

### 1) POST /api/route

Request schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://chasemapper.local/schemas/route-request-v1.json",
  "type": "object",
  "required": ["start_lat", "start_lon", "end_lat", "end_lon"],
  "properties": {
    "start_lat": { "type": "number", "minimum": -90, "maximum": 90 },
    "start_lon": { "type": "number", "minimum": -180, "maximum": 180 },
    "end_lat": { "type": "number", "minimum": -90, "maximum": 90 },
    "end_lon": { "type": "number", "minimum": -180, "maximum": 180 },
    "client_id": { "type": "string" }
  },
  "additionalProperties": false
}
```

`client_id` is optional but recommended for mobile clients: when present, the
computed route is stored per-client (so concurrent chasers each get their own
route back from `GET /api/mobile_state`) rather than in the single
server-wide "latest route" slot the desktop web app uses when it omits
`client_id`.

Response schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://chasemapper.local/schemas/route-response-v1.json",
  "type": "object",
  "required": ["feature", "distance_m", "duration_s", "provider", "provider_base", "steps", "alternatives"],
  "properties": {
    "feature": {
      "type": "object",
      "required": ["type", "geometry", "properties"],
      "properties": {
        "type": { "const": "Feature" },
        "geometry": {
          "type": "object",
          "required": ["type", "coordinates"],
          "properties": {
            "type": { "const": "LineString" },
            "coordinates": {
              "type": "array",
              "items": {
                "type": "array",
                "minItems": 2,
                "maxItems": 2,
                "items": [
                  { "type": "number" },
                  { "type": "number" }
                ]
              }
            }
          },
          "additionalProperties": true
        },
        "properties": { "type": "object" }
      },
      "additionalProperties": true
    },
    "distance_m": { "type": "number", "minimum": 0 },
    "duration_s": { "type": "number", "minimum": 0 },
    "provider": { "type": "string" },
    "provider_base": { "type": "string" },
    "steps": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": { "type": ["string", "null"] },
          "modifier": { "type": ["string", "null"] },
          "name": { "type": ["string", "null"] },
          "distance_m": { "type": ["number", "null"] },
          "location": { "type": ["array", "null"] }
        },
        "additionalProperties": true
      }
    },
    "alternatives": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["label", "feature", "distance_m", "duration_s", "steps"],
        "properties": {
          "label": { "enum": ["fastest", "shortest"] },
          "feature": { "type": "object" },
          "distance_m": { "type": "number", "minimum": 0 },
          "duration_s": { "type": "number", "minimum": 0 },
          "steps": { "type": "array" }
        },
        "additionalProperties": true
      }
    }
  },
  "additionalProperties": false
}
```

`steps`/`alternatives` mirror the fastest route; `alternatives` also includes
a `shortest`-labelled entry. The desktop web app computes its own turn list
client-side (Leaflet Routing Machine) and ignores these fields, but mobile
clients have no equivalent, so the backend provides them pre-normalized.

### 2) GET /api/latest_route

Response schema (GeoJSON Feature):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://chasemapper.local/schemas/latest-route-response-v1.json",
  "type": "object",
  "required": ["type", "geometry", "properties"],
  "properties": {
    "type": { "const": "Feature" },
    "geometry": {
      "type": "object",
      "required": ["type", "coordinates"],
      "properties": {
        "type": { "const": "LineString" },
        "coordinates": {
          "type": "array",
          "items": {
            "type": "array",
            "minItems": 2,
            "maxItems": 2,
            "items": [
              { "type": "number" },
              { "type": "number" }
            ]
          }
        }
      },
      "additionalProperties": true
    },
    "properties": { "type": "object" }
  },
  "additionalProperties": true
}
```

### 3) GET /api/mobile_state

Query parameters:

- `client_id` (optional string): when present, `route` reflects the route
  most recently computed by this client via `POST /api/route` (see above).
  When omitted, `route` reflects the shared server-wide latest route (the
  one the desktop web app uses).

Response schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://chasemapper.local/schemas/mobile-state-response-v1.json",
  "type": "object",
  "required": ["server_time", "car", "target", "route", "eta"],
  "properties": {
    "server_time": { "type": "string" },
    "car": {
      "type": ["object", "null"],
      "properties": {
        "lat": { "type": ["number", "null"] },
        "lon": { "type": ["number", "null"] },
        "alt": { "type": ["number", "null"] },
        "speed": { "type": ["number", "null"] },
        "heading": { "type": ["number", "null"] },
        "heading_valid": { "type": "boolean" },
        "last_update": { "type": ["string", "null"] }
      },
      "additionalProperties": true
    },
    "target": {
      "type": ["object", "null"],
      "properties": {
        "callsign": { "type": "string" },
        "landing": {
          "type": "object",
          "properties": {
            "lat": { "type": ["number", "null"] },
            "lon": { "type": ["number", "null"] },
            "alt": { "type": ["number", "null"] }
          },
          "additionalProperties": false
        },
        "telemetry": { "type": "object" },
        "time_to_landing": { "type": ["string", "null"] },
        "time_to_landing_s": { "type": ["integer", "null"], "minimum": 0 }
      },
      "additionalProperties": true
    },
    "route": {
      "type": "object",
      "properties": {
        "geojson": { "type": ["object", "null"] },
        "distance_m": { "type": ["number", "null"], "minimum": 0 },
        "duration_s": { "type": ["number", "null"], "minimum": 0 },
        "provider": { "type": ["string", "null"] },
        "provider_base": { "type": ["string", "null"] },
        "updated_at": { "type": ["string", "null"] },
        "steps": { "type": ["array", "null"] }
      },
      "additionalProperties": false
    },
    "eta": {
      "type": "object",
      "properties": {
        "route_duration_s": { "type": ["number", "null"], "minimum": 0 },
        "payload_time_to_landing_s": { "type": ["integer", "null"], "minimum": 0 },
        "payload_time_to_landing": { "type": ["string", "null"] }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

### 4) POST /api/device_position

REST equivalent of the `device_position` Socket.IO event: a fallback for when the live socket is down, e.g. after the OS drops it while the app is backgrounded. The server handles it exactly like the socket event, so other clients see the update either way.

Client rules (the mobile app's background location task follows these):
- Only send it while the Socket.IO connection is not connected. iOS keeps a backgrounded app with active location updates running, socket included, and positions keep flowing over the socket then; a REST copy would only be refused with `409`.
- Send at most one every 20s. iOS delivers background fixes by distance, not time, so at driving speed an unthrottled client would exceed the per-car rate limit below.

Request:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "DevicePositionRequest",
  "type": "object",
  "required": ["latitude", "longitude"],
  "properties": {
    "latitude": { "type": "number", "minimum": -90, "maximum": 90 },
    "longitude": { "type": "number", "minimum": -180, "maximum": 180 },
    "altitude": { "type": "number" },
    "heading": { "type": "number" },
    "heading_status": { "type": "string" },
    "client_id": { "type": "string", "description": "Persisted per-device id. Omit only for the legacy single primary car." },
    "name": { "type": "string", "description": "Display name for this chaser; defaults to client_id." }
  }
}
```

Responses:

- `200 {"ok": true}`
- `400` - body is not a JSON object
- `409 {"error": "owned by another active connection"}` - a live Socket.IO connection is currently sending positions for this `client_id`. For the mobile app that is normally this same device, just foregrounded again, so treat it as "already handled": don't retry it, don't show it as an error, and don't count it towards the circuit breaker. A live socket connection always takes a car over from REST updates; REST updates only take over once the socket has been quiet for the ownership grace period (20s).
- `429` - per-`client_id` (and coarser per-IP) rate limit, same limits as the socket event

### 5) GET /get_config

The server's shared configuration (prediction settings, APRS callsigns, map tile settings, etc.) - the same object pushed over Socket.IO as `server_settings_update` whenever a client changes a setting. Server-only secrets (`aprs_api_key`, `api_access_key`) are never included in either. Map tile provider keys are included, because clients need them to fetch tiles.

### 6) GET /get_telemetry_archive

Full history per tracked payload (`telem`, `path`, `pred_path`, `pred_landing`, `burst`, `abort_path`, `abort_landing`), keyed by callsign. Fetch once on every Socket.IO (re)connect: the live socket only carries the latest point or a full replacement prediction, never the accumulated path.

## Update Cadence

### Recommended Polling Intervals

- Foreground + active chase navigation:
  - `GET /api/mobile_state`: every `2s`
  - `POST /api/route`: on-demand only (start route, destination changed, off-route)
- Foreground + map open but passive:
  - `GET /api/mobile_state`: every `5s`
- Background or low-power mode:
  - `GET /api/mobile_state`: every `15-30s`
- `GET /api/latest_route`:
  - only when route view becomes active, after route recompute, or mobile_state indicates route update.

### Triggered Re-route Rules (client side)

- Recompute route when any is true:
  - destination moved by `>= 200m`
  - car deviated from route by `>= 60m`
  - no usable route exists
- Avoid recompute when:
  - destination shift `< 200m`
  - car remains near route (`<= 30m`), in which case advance progress along current polyline.

## Retry and Backoff Behavior

### Timeouts

- `GET /api/mobile_state`: client timeout `3s`
- `POST /api/route`: client timeout `8-10s`
- `GET /api/latest_route`: client timeout `3s`
- `GET /get_config`: client timeout `3s`
- `GET /get_telemetry_archive`: client timeout `8s` (can be large)

### Retry Matrix

- `429`:
  - honor `Retry-After` header or `retry_after_s`
  - do not immediate-retry
- `5xx` or network failure:
  - exponential backoff with jitter
  - example delays: `1s`, `2s`, `4s`, `8s`, cap at `15s`
- `401`:
  - do not retry blindly
  - refresh/reload API key and retry once
- `400`/`404`:
  - treat as non-retryable request/data issue unless app state changed.
- `409` (`POST /api/device_position` only):
  - not a failure - another live connection is already delivering this car's positions
  - do not retry, and do not count towards the circuit breaker.

### Circuit Breaker Recommendation

- After `5` consecutive failures on a single endpoint:
  - pause active polling for `30s`
  - keep UI in degraded mode with last known data timestamp.

## Other Chasers' Cars

Other chasers arrive as `telemetry_event` messages with `callsign: "CAR"` and a `car_id`. The server never sends an explicit "car left" event, so clients must expire them themselves:

- Drop a car not heard from for `15 min`, checked every `60s` (same as the desktop web client).
- On every Socket.IO (re)connect, clear all other cars before emitting `client_connected`. The server's `client_connected` handler replays the cars it currently tracks, so this refills the map with exactly the live set (and drops cars the server forgot, e.g. after a server restart).

## Compatibility Notes

- Optional/null fields are expected in low-data states (no car fix, no route, no prediction).
- Clients should parse unknown fields permissively for forward compatibility.
- Server-side auth/rate limits are configurable; mobile clients should always send `X-API-Key` when configured.

## Ready-to-Use Model Snippets

Platform-ready models generated from this contract are available in:

- [mobile-prototype/contract-snippets/ios/ChaseMapperContractModels.swift](../mobile-prototype/contract-snippets/ios/ChaseMapperContractModels.swift)
- [mobile-prototype/contract-snippets/android/ChaseMapperContractModels.kt](../mobile-prototype/contract-snippets/android/ChaseMapperContractModels.kt)
- [mobile-prototype/contract-snippets/README.md](../mobile-prototype/contract-snippets/README.md)
