import { useEffect } from 'react';
import { getMobileState } from './client';
import { useSettingsStore } from '../store/settingsStore';
import { useConnectionStore } from '../store/connectionStore';
import { useTelemetryStore } from '../store/telemetryStore';
import { useRouteStore } from '../store/routeStore';
import {
  MOBILE_STATE_POLL_ACTIVE_MS,
  MOBILE_STATE_POLL_PASSIVE_MS,
} from './constants';

/**
 * Polls GET /api/mobile_state as a complement to the Socket.IO live feed — it's the
 * only source for the server's pre-computed `route`/`eta` summary fields, and is the
 * sole data source before the socket connects or while it's reconnecting. See the
 * "Data authority rule" in the implementation plan: sockets win for live telemetry,
 * this fills in everything else.
 */
export function useMobileStatePolling(active: boolean) {
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const apiKey = useSettingsStore((s) => s.apiKey);
  const clientId = useSettingsStore((s) => s.clientId);
  const isHydrated = useSettingsStore((s) => s.isHydrated);
  const connectionStatus = useConnectionStore((s) => s.status);

  useEffect(() => {
    if (!isHydrated || !serverUrl) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const state = await getMobileState(serverUrl, apiKey, clientId);
        if (cancelled) return;
        useTelemetryStore.getState().setTarget(state.target);
        if (!state.car && connectionStatus !== 'connected') {
          useTelemetryStore.getState().clearPrimaryCar();
        } else if (state.car) {
          useTelemetryStore.getState().setPrimaryCarFromMobileState(state.car);
        }
        useRouteStore.getState().setRouteAndEta(state.route, state.eta);
      } catch {
        // Swallowed: this is a background reconciliation poll, not a user action —
        // the connection-status indicator (driven by the socket) is the source of
        // truth for surfacing connectivity problems to the user.
      } finally {
        if (!cancelled) {
          const intervalMs = active ? MOBILE_STATE_POLL_ACTIVE_MS : MOBILE_STATE_POLL_PASSIVE_MS;
          timer = setTimeout(poll, intervalMs);
        }
      }
    };

    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isHydrated, serverUrl, apiKey, clientId, active, connectionStatus]);
}
