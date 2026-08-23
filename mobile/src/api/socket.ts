import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getConfig, getTelemetryArchive } from './client';
import { useConnectionStore } from '../store/connectionStore';
import { useTelemetryStore } from '../store/telemetryStore';
import { useConfigStore } from '../store/configStore';
import { useLogStore } from '../store/logStore';
import { useAprsStore } from '../store/aprsStore';
import { useSettingsStore } from '../store/settingsStore';
import { useBearingStore } from '../store/bearingStore';
import type {
  AprsCallsignRemoved,
  AprsPredictionOverrideUpdatePayload,
  AprsRefreshComplete,
  BearingChange,
  BearingRejected,
  ChasemapperConfig,
  DevicePositionPayload,
  LogEvent,
  MarkRecoveredPayload,
  PredictorUpdate,
  PresenceUpdate,
  TelemetryEvent,
} from './types';

// Module-level handle to the live socket so screens can emit client -> server
// events without threading the socket instance through props/context. Only
// useChaseMapperSocket (mounted once at the app root) writes to this.
let activeSocket: Socket | null = null;

export function emitAprsCallsignAdd(callsign: string) {
  activeSocket?.emit('aprs_callsign_add', { callsign });
}

export function emitAprsCallsignRemove(callsign: string) {
  activeSocket?.emit('aprs_callsign_remove', { callsign });
}

export function emitAprsRefreshRequest(callsign: string) {
  activeSocket?.emit('aprs_refresh_request', { callsign });
}

export function emitAprsPredictionOverrideUpdate(payload: AprsPredictionOverrideUpdatePayload) {
  activeSocket?.emit('aprs_prediction_override_update', payload);
}

export function emitMarkRecovered(payload: MarkRecoveredPayload) {
  activeSocket?.emit('mark_recovered', payload);
}

export function emitDevicePosition(payload: DevicePositionPayload) {
  activeSocket?.emit('device_position', payload);
}

/**
 * Update server-global settings (client_settings_update). The handler applies every
 * CLIENT_SETTABLE_CONFIG_KEYS key present in the payload, but also reads a few keys
 * (pred_enabled, habitat_upload_enabled) directly off the raw payload to decide
 * whether to restart/stop the predictor or uploader — a payload missing those keys
 * would be read as `false` and could silently disable a running predictor for every
 * connected client. So this always sends the full current config, patched with the
 * caller's changes, never a partial object — mirrors what the desktop settings form
 * submits (the whole form, not a diff).
 */
export function emitClientSettingsUpdate(patch: Partial<ChasemapperConfig>) {
  const current = useConfigStore.getState().config;
  if (!current) return;
  activeSocket?.emit('client_settings_update', { ...current, ...patch });
}

/**
 * Owns the single Socket.IO connection to the backend's /chasemapper namespace and
 * dispatches every server event into the matching Zustand store. Mount once near the
 * app root. Reconnects (including the initial connect) always re-emit
 * `client_connected` so the server replays current state — see
 * doc/mobile-api-contract.md and horusmapper.py's `client_connected` handler.
 */
export function useChaseMapperSocket() {
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const apiKey = useSettingsStore((s) => s.apiKey);
  const clientId = useSettingsStore((s) => s.clientId);
  const isHydrated = useSettingsStore((s) => s.isHydrated);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!isHydrated || !serverUrl) return;

    const connection = useConnectionStore.getState();
    connection.setStatus('connecting');

    const socket = io(`${serverUrl}/chasemapper`, {
      query: apiKey ? { api_key: apiKey } : undefined,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5,
      reconnectionAttempts: Infinity,
      transports: ['websocket'],
    });
    socketRef.current = socket;
    activeSocket = socket;

    socket.on('connect', () => {
      useConnectionStore.getState().setStatus('connected');
      useConnectionStore.getState().setReconnectAttempt(0);
      socket.emit('client_connected', {});
      // server_settings_update only fires on config *mutations* — bootstrap the
      // canonical config here so screens (APRS callsigns, units, profiles) aren't
      // stuck waiting for someone to change a setting first.
      getConfig(serverUrl).then(
        (config) => useConfigStore.getState().setConfig(config),
        () => {} // non-critical bootstrap; server_settings_update will eventually arrive
      );
      // client_connected only replays each payload's *latest* point plus its current
      // prediction snapshot — never the accumulated flight path. Fetch the full
      // history here, same as the desktop client's fetchTelemetryArchive(), so the
      // actual-path trail/prediction/landing/burst aren't stuck empty until enough
      // live updates trickle in to rebuild them from scratch.
      getTelemetryArchive(serverUrl).then(
        (archive) => useTelemetryStore.getState().hydrateFromArchive(archive),
        () => {} // non-critical bootstrap; live socket events still populate everything else
      );
    });

    socket.on('disconnect', () => {
      useConnectionStore.getState().setStatus('disconnected');
    });

    socket.on('connect_error', (err: Error) => {
      useConnectionStore.getState().setStatus('error', err.message);
    });

    socket.io.on('reconnect_attempt', (attempt: number) => {
      useConnectionStore.getState().setStatus('reconnecting');
      useConnectionStore.getState().setReconnectAttempt(attempt);
    });

    socket.on('presence_update', (data: PresenceUpdate) => {
      useConnectionStore.getState().setConnectedChasers(data.connected);
    });

    socket.on('telemetry_event', (data: TelemetryEvent) => {
      useTelemetryStore.getState().handleTelemetryEvent(data, clientId);
    });

    socket.on('predictor_update', (data: PredictorUpdate) => {
      useTelemetryStore.getState().handlePredictorUpdate(data);
    });

    socket.on('server_settings_update', (data: ChasemapperConfig) => {
      useConfigStore.getState().setConfig(data);
    });

    socket.on('aprs_callsign_removed', (data: AprsCallsignRemoved) => {
      useTelemetryStore.getState().clearBalloon(data.callsign);
      useAprsStore.getState().clearRefreshing(data.callsign);
    });

    socket.on('aprs_refresh_complete', (data: AprsRefreshComplete) => {
      useAprsStore.getState().clearRefreshing(data.callsign);
    });

    socket.on('log_event', (data: LogEvent) => {
      useLogStore.getState().addEntry(data);
    });

    socket.on('bearing_change', (data: BearingChange) => {
      if (data.add) useBearingStore.getState().upsert(data.add);
      if (data.remove?.length) useBearingStore.getState().remove(data.remove);
    });

    socket.on('bearing_rejected', (_data: BearingRejected) => {
      // No known chase-car position to resolve the bearing against yet — silent,
      // matches the desktop web app's handling (nothing user-actionable to show).
    });

    // operator_action_denied and predictor_model_update are consumed by screens
    // landing in later phases — wired up alongside those screens rather than
    // dispatched to nowhere here.

    return () => {
      socket.disconnect();
      socketRef.current = null;
      activeSocket = null;
    };
  }, [isHydrated, serverUrl, apiKey, clientId]);

  return socketRef;
}
