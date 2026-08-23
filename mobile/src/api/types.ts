// Hand-written mirror of the backend contract documented in doc/mobile-api-contract.md
// and verified against horusmapper.py / chasemapper/config.py. Keep in sync manually —
// there is no codegen source on the backend side.

export type LatLonAlt = [lat: number, lon: number, alt: number];

// ---------------------------------------------------------------------------
// REST: GET /api/mobile_state
// ---------------------------------------------------------------------------

export interface CarState {
  lat: number | null;
  lon: number | null;
  alt: number | null;
  speed: number | null;
  heading: number | null;
  heading_valid: boolean;
  last_update: string | null;
}

export interface PayloadTelem {
  callsign: string;
  position: LatLonAlt;
  vel_v: number;
  speed: number;
  short_time: string;
  packet_time: string;
  time_to_landing: string | null;
  server_time: number;
  max_alt: number;
  bt?: string;
  temp?: number;
  humidity?: number;
  sats?: number;
  snr?: number;
}

export interface TargetState {
  callsign: string;
  landing: { lat: number | null; lon: number | null; alt: number | null };
  telemetry: PayloadTelem;
  time_to_landing: string | null;
  time_to_landing_s: number | null;
}

export interface RouteStep {
  type: string | null;
  modifier: string | null;
  name: string;
  distance_m: number;
  // [lon, lat] of the maneuver, or null if OSRM omitted it. Used to compute which
  // steps the chase car has already passed — see utils/routeProgress.ts.
  location: [number, number] | null;
}

export interface RouteState {
  geojson: GeoJSON.Feature<GeoJSON.LineString> | null;
  distance_m: number | null;
  duration_s: number | null;
  provider: string | null;
  provider_base: string | null;
  updated_at: string | null;
  steps: RouteStep[] | null;
}

export interface EtaState {
  route_duration_s: number | null;
  payload_time_to_landing_s: number | null;
  payload_time_to_landing: string | null;
}

export interface MobileState {
  server_time: string;
  car: CarState | null;
  target: TargetState | null;
  route: RouteState;
  eta: EtaState;
}

// ---------------------------------------------------------------------------
// REST: POST /api/route, GET/POST /api/latest_route
// ---------------------------------------------------------------------------

export interface RouteRequest {
  start_lat: number;
  start_lon: number;
  end_lat: number;
  end_lon: number;
  // Scopes this route to the requesting device on the server (see
  // client_routes in horusmapper.py) so it's returned only to this client's own
  // /api/mobile_state polls, never bleeding into another chaser's Route screen.
  client_id: string;
}

export interface RouteAlternative {
  label: 'fastest' | 'shortest';
  feature: GeoJSON.Feature<GeoJSON.LineString>;
  distance_m: number;
  duration_s: number;
  steps: RouteStep[];
}

export interface RouteResponse {
  feature: GeoJSON.Feature<GeoJSON.LineString>;
  distance_m: number;
  duration_s: number;
  provider: string;
  provider_base: string;
  steps: RouteStep[];
  alternatives: RouteAlternative[];
}

// ---------------------------------------------------------------------------
// REST: GET /get_config, and Socket.IO server_settings_update payload
// ---------------------------------------------------------------------------

export interface ChaseProfile {
  name: string;
  online_tracker: string;
  telemetry_source_type: string;
  telemetry_source_port: number;
  car_source_type: string;
  car_source_port: number;
}

export interface ChasemapperConfig {
  version: string;
  unitselection: 'metric' | 'imperial';
  pred_enabled: boolean;
  pred_model: string;
  pred_model_time: string;
  pred_desc_rate: number;
  pred_burst: number;
  pred_update_rate: number;
  show_abort: boolean;
  aprs_enabled: boolean;
  aprs_callsigns: string[];
  aprs_prediction_overrides: Record<string, { pred_burst?: number; pred_desc_rate?: number }>;
  aprs_poll_interval: number;
  aprs_timezone: string;
  habitat_call: string;
  habitat_upload_enabled: boolean;
  selected_profile: string;
  profiles: Record<string, ChaseProfile>;
  // Server sends additional fields not modeled here (range rings, bearings, tile
  // server, etc.) — parse permissively and only add fields as screens need them.
  [key: string]: unknown;
}

export const CLIENT_SETTABLE_CONFIG_KEYS = [
  'aprs_enabled',
  'aprs_poll_interval',
  'habitat_call',
  'habitat_update_rate',
  'habitat_upload_enabled',
  'max_bearing_age',
  'pred_burst',
  'pred_desc_rate',
  'pred_enabled',
  'pred_model',
  'pred_model_time',
  'pred_update_rate',
  'show_abort',
  'time_seq_active',
  'time_seq_cycle',
  'time_seq_enabled',
  'time_seq_times',
] as const;

// ---------------------------------------------------------------------------
// Socket.IO — namespace /chasemapper
// ---------------------------------------------------------------------------

export interface TelemetryEventBalloon extends PayloadTelem {}

export interface TelemetryEventCar {
  callsign: 'CAR';
  position: LatLonAlt;
  vel_v: 0;
  heading: number;
  heading_valid: boolean;
  heading_status: string | null;
  speed: number;
  numSV?: number;
  replay_time?: string;
  car_id?: string;
  car_name?: string;
}

export type TelemetryEvent = TelemetryEventBalloon | TelemetryEventCar;

export function isCarTelemetry(event: TelemetryEvent): event is TelemetryEventCar {
  return event.callsign === 'CAR';
}

export interface PredictorUpdate {
  callsign: string;
  pred_path: LatLonAlt[];
  pred_landing: LatLonAlt | [];
  burst: LatLonAlt | [];
  abort_path: LatLonAlt[];
  abort_landing: LatLonAlt | [];
}

// ---------------------------------------------------------------------------
// REST: GET /get_telemetry_archive
// ---------------------------------------------------------------------------

// One entry per tracked payload, keyed by callsign. Mirrors the server's
// in-memory current_payloads[callsign] (see horusmapper.py) — the same shape
// telemetry_event/predictor_update are derived from, but with the full
// accumulated path/pred_path/etc rather than just the latest point. Fetched
// once on socket connect to hydrate history that the live socket events
// (which only ever carry the latest point or a full-replacement prediction)
// never provide on their own.
export interface TelemetryArchiveEntry {
  telem: PayloadTelem;
  path: LatLonAlt[];
  pred_path: LatLonAlt[];
  pred_landing: LatLonAlt | [];
  burst: LatLonAlt | [];
  abort_path: LatLonAlt[];
  abort_landing: LatLonAlt | [];
}

export type TelemetryArchive = Record<string, TelemetryArchiveEntry>;

export interface PredictorModelUpdate {
  model: string;
  time?: string;
}

export interface PresenceUpdate {
  connected: number;
}

export interface OperatorActionDenied {
  action: string;
  reason: 'unauthorized';
}

export interface AprsRefreshComplete {
  callsign: string;
  success: boolean;
}

export interface AprsCallsignRemoved {
  callsign: string;
}

export interface Bearing {
  key: string;
  timestamp: number;
  src_timestamp: number;
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  heading_valid: boolean;
  raw_bearing: number;
  true_bearing: number;
  confidence: number;
  power: number;
  source: string;
  raw_bearing_angles?: number[];
  raw_doa?: number[];
}

export interface BearingChange {
  add: Bearing;
  remove: string[];
  server_timestamp: number;
}

export interface BearingRejected {
  reason: 'no_known_position';
}

export interface LogEvent {
  level: string;
  timestamp: string;
  msg: string;
}

// ---------------------------------------------------------------------------
// Socket.IO — client -> server emit payloads
// ---------------------------------------------------------------------------

export interface DevicePositionPayload {
  latitude: number;
  longitude: number;
  altitude?: number;
  heading?: number;
  heading_status?: string;
  client_id: string;
  name?: string;
}

export interface MarkRecoveredPayload {
  payload_call: string;
  my_call: string;
  last_pos: LatLonAlt;
  message: string;
  recovered: boolean;
}

export interface AprsPredictionOverrideUpdatePayload {
  callsign: string;
  pred_burst?: number;
  pred_desc_rate?: number;
}

// ---------------------------------------------------------------------------
// REST error envelope
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  error: string;
  retry_after_s?: number;
}
