# Contract Snippets (Ready to Integrate)

Generated, contract-aligned models for immediate iOS/Android integration.

- iOS (Swift Codable): `ios/ChaseMapperContractModels.swift`
- Android (Kotlinx Serialization data classes): `android/ChaseMapperContractModels.kt`

Coverage:

- `POST /api/route` request/response
- `GET /api/latest_route` response
- `GET /api/mobile_state` response
- Common error payload (`error`, `retry_after_s`)
- Minimal GeoJSON feature/geometry models

## iOS usage

```swift
let decoder = JSONDecoder()
let state = try decoder.decode(MobileStateResponse.self, from: data)
```

## Android usage

```kotlin
val json = Json { ignoreUnknownKeys = true }
val state = json.decodeFromString<MobileStateResponse>(payload)
```

Notes:

- GeoJSON coordinates are `[lon, lat]`.
- Both snippets keep optional fields nullable to match low-data server states.
