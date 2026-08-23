import { useEffect } from 'react';
import * as Location from 'expo-location';
import { postRoute } from './client';
import { useSettingsStore } from '../store/settingsStore';
import { useRouteStore } from '../store/routeStore';
import { useTelemetryStore } from '../store/telemetryStore';
import { ROUTE_AUTO_REFRESH_MS } from './constants';

async function resolveStart(): Promise<{ lat: number; lon: number } | null> {
  const { startMode, manualStart } = useRouteStore.getState();
  if (startMode === 'manual') return manualStart;

  if (startMode === 'myGps') {
    try {
      const loc = await Location.getCurrentPositionAsync({});
      return { lat: loc.coords.latitude, lon: loc.coords.longitude };
    } catch {
      return null;
    }
  }

  // 'chaseCar' (and the null/unset fallback, e.g. after a hot reload). ownCar
  // (this device's own GPS, echoed back once "Share my live location" is on)
  // is the primary source. primaryCar is a single hardware GPS shared by every
  // client connected to the server (e.g. a dedicated receiver in the actual
  // chase vehicle) — it is NOT necessarily this phone's position, so it's only
  // used as an absolute last resort after a direct GPS query also fails, never
  // preferred over this device's own location.
  const { ownCar, primaryCar } = useTelemetryStore.getState();
  if (ownCar) return { lat: ownCar.position[0], lon: ownCar.position[1] };
  try {
    const loc = await Location.getCurrentPositionAsync({});
    return { lat: loc.coords.latitude, lon: loc.coords.longitude };
  } catch {
    // Fall through to the shared hardware GPS below.
  }
  if (primaryCar?.lat != null && primaryCar?.lon != null) {
    return { lat: primaryCar.lat, lon: primaryCar.lon };
  }
  return null;
}

/**
 * Keeps an active "Start Routing" route pointed at the target's predicted landing
 * point (falling back to its live position if no prediction has arrived yet — same
 * rule as StartRoutingSheet). The server only computes a route when asked (POST
 * /api/route or the desktop's own push) and never re-derives it as the prediction
 * updates, so without this the drawn route quietly goes stale — still a real,
 * road-following OSRM route, just to wherever the landing was predicted to be at the
 * moment routing was started. Re-resolves the start point the same way it was
 * originally chosen (chase car / device GPS / fixed manual point) so the refresh
 * matches what the user asked for.
 */
export function useRouteAutoRefresh() {
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const apiKey = useSettingsStore((s) => s.apiKey);
  const clientId = useSettingsStore((s) => s.clientId);
  const isHydrated = useSettingsStore((s) => s.isHydrated);
  const targetCallsign = useRouteStore((s) => s.targetCallsign);
  const followedCallsign = useTelemetryStore((s) => s.followedCallsign);

  useEffect(() => {
    if (!isHydrated || !serverUrl || !clientId || !targetCallsign) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const refresh = async () => {
      try {
        const { targetCallsign: currentTarget } = useRouteStore.getState();
        if (!currentTarget) return;

        const target = useTelemetryStore.getState().balloons[currentTarget];
        const start = await resolveStart();
        if (cancelled || !target || !start) return;

        const end = target.predLanding ?? target.telem.position;
        const response = await postRoute(serverUrl, apiKey, {
          start_lat: start.lat,
          start_lon: start.lon,
          end_lat: end[0],
          end_lon: end[1],
          client_id: clientId,
        });
        if (cancelled) return;
        // Re-check targetCallsign wasn't cleared/changed while the request was in flight.
        if (useRouteStore.getState().targetCallsign === currentTarget) {
          useRouteStore.getState().updateAlternatives(response.alternatives);
        }
      } catch {
        // Non-critical background refresh — the last-known route stays displayed.
      } finally {
        if (!cancelled) timer = setTimeout(refresh, ROUTE_AUTO_REFRESH_MS);
      }
    };

    timer = setTimeout(refresh, ROUTE_AUTO_REFRESH_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isHydrated, serverUrl, apiKey, clientId, targetCallsign]);

  // Retarget an already-active route the moment the user starts following a
  // different callsign elsewhere in the app (APRS list "Follow", tapping a balloon
  // marker) — without this, Route tab keeps showing directions to whichever
  // balloon "Start Routing" was last pressed for, even after the user switches to
  // tracking someone else. Mirrors the desktop web client's behaviour of always
  // routing to whatever `window.balloon_currently_chased` currently is. Only fires
  // while a route is already active (targetCallsign set) — following a callsign
  // with no route running never auto-starts one.
  useEffect(() => {
    if (!isHydrated || !serverUrl || !clientId || !followedCallsign) return;

    const { targetCallsign: activeTarget } = useRouteStore.getState();
    if (!activeTarget || activeTarget === followedCallsign) return;

    let cancelled = false;

    (async () => {
      const target = useTelemetryStore.getState().balloons[followedCallsign];
      const start = await resolveStart();
      if (cancelled || !target || !start) return;

      const end = target.predLanding ?? target.telem.position;
      try {
        const response = await postRoute(serverUrl, apiKey, {
          start_lat: start.lat,
          start_lon: start.lon,
          end_lat: end[0],
          end_lon: end[1],
          client_id: clientId,
        });
        if (cancelled) return;
        // Re-check nothing else (e.g. Stop, or another follow switch) changed
        // things while this request was in flight.
        const { targetCallsign: stillActiveTarget, startMode, manualStart } = useRouteStore.getState();
        if (stillActiveTarget === activeTarget) {
          useRouteStore.getState().setAlternatives(response.alternatives, followedCallsign, startMode ?? 'chaseCar', manualStart);
        }
      } catch {
        // Leave the previous route displayed — the periodic refresh above will
        // keep retrying against the old target until this succeeds or the user
        // follows someone else again.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [followedCallsign, isHydrated, serverUrl, apiKey, clientId]);
}
