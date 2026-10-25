import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { useSettingsStore } from '../store/settingsStore';
import { useLocationShareStore } from '../store/locationShareStore';
import { useConnectionStore, type ConnectionStatus } from '../store/connectionStore';
import { ApiError, postDevicePosition } from '../api/client';
import { DEVICE_POSITION_BACKGROUND_INTERVAL_MS } from '../api/constants';

export const BACKGROUND_LOCATION_TASK_NAME = 'chasemapper-background-location';

let lastPostAtMs = 0;

/**
 * Whether a background fix should be POSTed. Two rules:
 * - Only while the live socket is down. iOS keeps the app (and its socket)
 *   running in the background while location updates are active, and
 *   useDevicePositionSharing.ts's watch keeps sending over that socket; the
 *   server would refuse a REST copy with 409 because the socket owns the car.
 * - At most once per DEVICE_POSITION_BACKGROUND_INTERVAL_MS. iOS ignores the
 *   task's timeInterval and delivers a fix every distanceInterval metres, which
 *   at highway speed would exceed the server's per-car rate limit.
 */
export function isTransientLocationError(error: { message?: string; code?: unknown } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return message.includes('kCLErrorDomain') && /Code=0\b/.test(message);
}

export function shouldPostBackgroundPosition(
  connectionStatus: ConnectionStatus,
  nowMs: number,
  lastPostMs: number
): boolean {
  if (connectionStatus === 'connected') return false;
  return nowMs - lastPostMs >= DEVICE_POSITION_BACKGROUND_INTERVAL_MS;
}

/**
 * Keeps "Share my live location" (see useDevicePositionSharing.ts) working
 * once the app is backgrounded. emitDevicePosition() over the live Socket.IO
 * connection (api/socket.ts) is foreground-only in practice - a persistent
 * background socket connection isn't reliable, especially on iOS - so this
 * task instead POSTs each update to /api/device_position (a plain `fetch`,
 * which does work reliably in a background execution context) via the
 * backend's REST equivalent of the same event.
 *
 * TaskManager.defineTask must run at module load, unconditionally, before
 * Location.startLocationUpdatesAsync/stopLocationUpdatesAsync are ever
 * called - this module is imported (for that side effect) by
 * useDevicePositionSharing.ts, which App.tsx already mounts at startup.
 */
TaskManager.defineTask<{ locations?: Location.LocationObject[] } | null>(
  BACKGROUND_LOCATION_TASK_NAME,
  async ({ data, error }) => {
    if (error) {
      // kCLErrorLocationUnknown (code 0): no fix right now (tunnel, garage,
      // indoors). Apple documents it as transient - Core Location keeps trying -
      // so it isn't worth alarming the user with a raw error string.
      if (isTransientLocationError(error)) return;
      useLocationShareStore.getState().setError(error.message);
      return;
    }

    const locations = data?.locations;
    const loc = locations?.[locations.length - 1];
    if (!loc) return;

    const { serverUrl, apiKey, clientId, chaserName, shareLocation } = useSettingsStore.getState();
    // Belt-and-suspenders: stopBackgroundLocationTracking() should already
    // have torn this down when sharing was disabled, but a queued/in-flight
    // update from just before that shouldn't ever be sent.
    if (!shareLocation || !serverUrl || !clientId) return;

    const now = Date.now();
    if (!shouldPostBackgroundPosition(useConnectionStore.getState().status, now, lastPostAtMs)) return;
    // Counted on attempt, not success, so a failing server isn't retried on every fix.
    lastPostAtMs = now;

    const headingValid = loc.coords.heading != null && loc.coords.heading >= 0;
    try {
      await postDevicePosition(serverUrl, apiKey, {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        altitude: loc.coords.altitude ?? undefined,
        heading: headingValid ? loc.coords.heading! : undefined,
        heading_status: headingValid ? 'gps' : undefined,
        client_id: clientId,
        name: chaserName || undefined,
      });
      useLocationShareStore.getState().setError(null);
    } catch (e) {
      // 409: the server ignored this update because a live socket connection
      // (this device reconnecting) owns the car again and is delivering
      // positions itself, so nothing is wrong.
      if (e instanceof ApiError && e.status === 409) return;
      useLocationShareStore
        .getState()
        .setError(e instanceof Error ? e.message : 'Background location update failed.');
    }
  }
);

export async function startBackgroundLocationTracking(): Promise<void> {
  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(
    BACKGROUND_LOCATION_TASK_NAME
  ).catch(() => false);
  if (alreadyStarted) return;

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    timeInterval: DEVICE_POSITION_BACKGROUND_INTERVAL_MS,
    distanceInterval: 15,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'ChaseMapper is sharing your location',
      notificationBody: 'Your position is being sent to your chase team.',
    },
  });
}

export async function stopBackgroundLocationTracking(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(
    BACKGROUND_LOCATION_TASK_NAME
  ).catch(() => false);
  if (started) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK_NAME);
  }
}
