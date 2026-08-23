import type {
  ApiErrorBody,
  ChasemapperConfig,
  MobileState,
  RouteRequest,
  RouteResponse,
  TelemetryArchive,
} from './types';
import {
  CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  CIRCUIT_BREAKER_PAUSE_MS,
  LATEST_ROUTE_TIMEOUT_MS,
  MOBILE_STATE_TIMEOUT_MS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_ATTEMPTS,
  RETRY_MAX_DELAY_MS,
  ROUTE_TIMEOUT_MS,
  TELEMETRY_ARCHIVE_TIMEOUT_MS,
} from './constants';

export class ApiError extends Error {
  status: number;
  retryAfterS?: number;

  constructor(status: number, message: string, retryAfterS?: number) {
    super(message);
    this.status = status;
    this.retryAfterS = retryAfterS;
  }
}

// Per-endpoint circuit breaker (doc/mobile-api-contract.md's recommendation): after
// CIRCUIT_BREAKER_FAILURE_THRESHOLD consecutive failures, stop hammering that endpoint
// for CIRCUIT_BREAKER_PAUSE_MS. Keyed by endpoint name, shared across the app since
// there's exactly one configured backend at a time.
const circuits = new Map<string, { failures: number; pausedUntil: number | null }>();

function getCircuit(key: string) {
  let circuit = circuits.get(key);
  if (!circuit) {
    circuit = { failures: 0, pausedUntil: null };
    circuits.set(key, circuit);
  }
  return circuit;
}

export function isCircuitOpen(key: string): boolean {
  const circuit = getCircuit(key);
  return circuit.pausedUntil !== null && circuit.pausedUntil > Date.now();
}

function recordSuccess(key: string) {
  circuits.set(key, { failures: 0, pausedUntil: null });
}

function recordFailure(key: string) {
  const circuit = getCircuit(key);
  circuit.failures += 1;
  if (circuit.failures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
    circuit.pausedUntil = Date.now() + CIRCUIT_BREAKER_PAUSE_MS;
  }
}

function backoffDelayMs(attempt: number): number {
  const exponential = RETRY_BASE_DELAY_MS * 2 ** attempt;
  const capped = Math.min(exponential, RETRY_MAX_DELAY_MS);
  const jitter = capped * 0.1 * Math.random();
  return capped + jitter;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseErrorBody(res: Response): Promise<ApiErrorBody | null> {
  try {
    return (await res.json()) as ApiErrorBody;
  } catch {
    return null;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeoutMs: number;
  circuitKey: string;
  apiKey: string | null;
}

async function requestJson<T>(url: string, opts: RequestOptions): Promise<T> {
  if (isCircuitOpen(opts.circuitKey)) {
    throw new ApiError(0, `circuit open for ${opts.circuitKey}`);
  }

  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(opts.apiKey ? { 'X-API-Key': opts.apiKey } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        recordSuccess(opts.circuitKey);
        return (await res.json()) as T;
      }

      const body = await parseErrorBody(res);

      // 429: honor Retry-After, never auto-retry.
      if (res.status === 429) {
        recordFailure(opts.circuitKey);
        const headerRetry = Number(res.headers.get('Retry-After'));
        throw new ApiError(429, body?.error ?? 'rate limited', body?.retry_after_s ?? (Number.isFinite(headerRetry) ? headerRetry : undefined));
      }

      // 401/400/404: non-retryable request/auth issues.
      if (res.status === 401 || res.status === 400 || res.status === 404) {
        recordFailure(opts.circuitKey);
        throw new ApiError(res.status, body?.error ?? 'request failed');
      }

      // 5xx: retryable with exponential backoff + jitter.
      recordFailure(opts.circuitKey);
      if (attempt < RETRY_MAX_ATTEMPTS - 1 && !isCircuitOpen(opts.circuitKey)) {
        await delay(backoffDelayMs(attempt));
        continue;
      }
      throw new ApiError(res.status, body?.error ?? 'server error');
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ApiError) throw err;

      // Network failure or timeout abort — also retryable.
      recordFailure(opts.circuitKey);
      if (attempt < RETRY_MAX_ATTEMPTS - 1 && !isCircuitOpen(opts.circuitKey)) {
        await delay(backoffDelayMs(attempt));
        continue;
      }
      throw new ApiError(0, 'network error');
    }
  }

  // Unreachable: the loop always returns or throws.
  throw new ApiError(0, 'exhausted retries');
}

export function getMobileState(baseUrl: string, apiKey: string | null, clientId: string | null): Promise<MobileState> {
  // client_id scopes the returned `route` to this device's own last-computed
  // route (see client_routes in horusmapper.py) — without it the server can't
  // tell this client's route apart from any other chaser's.
  const url = clientId
    ? `${baseUrl}/api/mobile_state?client_id=${encodeURIComponent(clientId)}`
    : `${baseUrl}/api/mobile_state`;
  return requestJson<MobileState>(url, {
    timeoutMs: MOBILE_STATE_TIMEOUT_MS,
    circuitKey: 'mobile_state',
    apiKey,
  });
}

export function postRoute(baseUrl: string, apiKey: string | null, req: RouteRequest): Promise<RouteResponse> {
  return requestJson<RouteResponse>(`${baseUrl}/api/route`, {
    method: 'POST',
    body: req,
    timeoutMs: ROUTE_TIMEOUT_MS,
    circuitKey: 'route',
    apiKey,
  });
}

export function getLatestRoute(baseUrl: string, apiKey: string | null): Promise<GeoJSON.Feature<GeoJSON.LineString>> {
  return requestJson<GeoJSON.Feature<GeoJSON.LineString>>(`${baseUrl}/api/latest_route`, {
    timeoutMs: LATEST_ROUTE_TIMEOUT_MS,
    circuitKey: 'latest_route',
    apiKey,
  });
}

export function postLatestRoute(
  baseUrl: string,
  apiKey: string | null,
  feature: GeoJSON.Feature<GeoJSON.LineString>
): Promise<{ status: string }> {
  return requestJson<{ status: string }>(`${baseUrl}/api/latest_route`, {
    method: 'POST',
    body: feature,
    timeoutMs: LATEST_ROUTE_TIMEOUT_MS,
    circuitKey: 'latest_route',
    apiKey,
  });
}

export function getConfig(baseUrl: string): Promise<ChasemapperConfig> {
  // Not auth/rate-limited per the contract doc, but shares the same client for consistency.
  return requestJson<ChasemapperConfig>(`${baseUrl}/get_config`, {
    timeoutMs: MOBILE_STATE_TIMEOUT_MS,
    circuitKey: 'get_config',
    apiKey: null,
  });
}

// One-shot bootstrap of full flight history (actual path, predicted path, landing,
// burst, abort path) — the live socket only ever carries the latest point or a
// full-replacement prediction, never the accumulated history. Mirrors the desktop
// web client's fetchTelemetryArchive(), called once per socket connect/reconnect.
// Not auth/rate-limited, same as /get_config.
export function getTelemetryArchive(baseUrl: string): Promise<TelemetryArchive> {
  return requestJson<TelemetryArchive>(`${baseUrl}/get_telemetry_archive`, {
    timeoutMs: TELEMETRY_ARCHIVE_TIMEOUT_MS,
    circuitKey: 'telemetry_archive',
    apiKey: null,
  });
}
