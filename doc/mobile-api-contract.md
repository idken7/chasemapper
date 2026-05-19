# Chasemapper Mobile API Contract

This document defines the mobile-facing API contract for route and chase-state consumption.

- Version: `v1`
- Transport: HTTPS + JSON (`application/json`)
- Auth: `X-API-Key` header (recommended for internet-exposed deployments)
- Time format: ISO-8601 UTC strings

## Base Behavior

- Success codes: `200`
- Client errors: `400`, `401`, `404`, `429`
- Server/upstream errors: `500`, `502`

Common error payload shape:

```json
{
  "error": "string",
  "retry_after_s": 12
}
```

`retry_after_s` is present for `429` rate-limit responses.

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
    "end_lon": { "type": "number", "minimum": -180, "maximum": 180 }
  },
  "additionalProperties": false
}
```

Response schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://chasemapper.local/schemas/route-response-v1.json",
  "type": "object",
  "required": ["feature", "distance_m", "duration_s", "provider", "provider_base"],
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
    "provider_base": { "type": "string" }
  },
  "additionalProperties": false
}
```

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
        "updated_at": { "type": ["string", "null"] }
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

### Circuit Breaker Recommendation

- After `5` consecutive failures on a single endpoint:
  - pause active polling for `30s`
  - keep UI in degraded mode with last known data timestamp.

## Compatibility Notes

- Optional/null fields are expected in low-data states (no car fix, no route, no prediction).
- Clients should parse unknown fields permissively for forward compatibility.
- Server-side auth/rate limits are configurable; mobile clients should always send `X-API-Key` when configured.

## Ready-to-Use Model Snippets

Platform-ready models generated from this contract are available in:

- [mobile-prototype/contract-snippets/ios/ChaseMapperContractModels.swift](../mobile-prototype/contract-snippets/ios/ChaseMapperContractModels.swift)
- [mobile-prototype/contract-snippets/android/ChaseMapperContractModels.kt](../mobile-prototype/contract-snippets/android/ChaseMapperContractModels.kt)
- [mobile-prototype/contract-snippets/README.md](../mobile-prototype/contract-snippets/README.md)
