import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { useSettingsStore } from '../store/settingsStore';
import { emitDevicePosition } from '../api/socket';
import { useConnectionStore } from '../store/connectionStore';
import { useLocationShareStore } from '../store/locationShareStore';
import {
  startBackgroundLocationTracking,
  stopBackgroundLocationTracking,
} from './backgroundLocationTask';

/**
 * Mirrors the desktop web app's "Share My Live Location" setting — while enabled,
 * watches this device's GPS and emits `device_position` so it shows up on everyone's
 * map as an independent chase car (keyed by settingsStore.clientId, see
 * location/clientIdentity.ts). Mount once at the app root.
 *
 * Unlike a browser, native GPS access here isn't gated behind a secure-context
 * (HTTPS) requirement - failures are permission/services issues, not a page
 * transport problem. Any failure is surfaced via locationShareStore (rendered
 * in Settings) and turns the "Share my live location" toggle back off, rather
 * than leaving it silently on while nothing is actually being sent.
 *
 * Also starts/stops backgroundLocationTask.ts's TaskManager-backed tracking
 * alongside the foreground watch below, so sharing keeps working once the app
 * is backgrounded (phone locked, or switched to a separate nav app while
 * driving) - the foreground watchPositionAsync subscription pauses then.
 * Background permission is requested separately, after foreground is granted
 * (required on Android 10+; a no-op re-prompt on iOS if already granted) -
 * its denial only disables background continuity, not foreground sharing.
 */
export function useDevicePositionSharing() {
  const shareLocation = useSettingsStore((s) => s.shareLocation);
  const clientId = useSettingsStore((s) => s.clientId);
  const chaserName = useSettingsStore((s) => s.chaserName);
  const isHydrated = useSettingsStore((s) => s.isHydrated);
  const setShareLocation = useSettingsStore((s) => s.setShareLocation);
  const connectionStatus = useConnectionStore((s) => s.status);
  const setLocationShareError = useLocationShareStore((s) => s.setError);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    if (!shareLocation || !isHydrated || !clientId || connectionStatus !== 'connected') return;

    let cancelled = false;

    function fail(message: string) {
      if (cancelled) return;
      setLocationShareError(message);
      setShareLocation(false);
    }

    (async () => {
      setLocationShareError(null);

      let permission;
      try {
        permission = await Location.requestForegroundPermissionsAsync();
      } catch (e) {
        fail(e instanceof Error ? e.message : 'Failed to request location permission.');
        return;
      }
      if (cancelled) return;
      if (permission.status !== Location.PermissionStatus.GRANTED) {
        fail(
          permission.canAskAgain
            ? 'Location permission denied.'
            : 'Location permission denied — enable it for this app in your device Settings.'
        );
        return;
      }

      try {
        subscriptionRef.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 15 },
          (loc) => {
            setLocationShareError(null);
            const headingValid = loc.coords.heading != null && loc.coords.heading >= 0;
            emitDevicePosition({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              altitude: loc.coords.altitude ?? undefined,
              heading: headingValid ? loc.coords.heading! : undefined,
              heading_status: headingValid ? 'gps' : undefined,
              client_id: clientId,
              name: chaserName || undefined,
            });
          },
          (reason) => {
            fail(reason || 'Lost the GPS fix.');
          }
        );
      } catch (e) {
        fail(e instanceof Error ? e.message : 'Could not start watching location.');
      }
    })();

    return () => {
      cancelled = true;
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
  }, [shareLocation, isHydrated, clientId, chaserName, connectionStatus, setShareLocation, setLocationShareError]);

  // Deliberately its own effect, not merged into the one above: that one is
  // gated on connectionStatus === 'connected' and tears down when the socket
  // drops - which is exactly what happens when the app backgrounds. The
  // background task exists specifically to keep working through that, so it
  // must not share that dependency/cleanup. Background permission denial (or
  // any start failure) is silently non-fatal here - foreground sharing above
  // is unaffected, this only means sharing pauses while backgrounded.
  useEffect(() => {
    if (!shareLocation || !isHydrated || !clientId) {
      stopBackgroundLocationTracking().catch(() => {});
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const fgPermission = await Location.getForegroundPermissionsAsync();
        if (fgPermission.status !== Location.PermissionStatus.GRANTED) return;
        const bgPermission = await Location.requestBackgroundPermissionsAsync();
        if (cancelled || bgPermission.status !== Location.PermissionStatus.GRANTED) return;
        await startBackgroundLocationTracking();
      } catch {
        // Non-fatal - see comment above.
      }
    })();

    return () => {
      cancelled = true;
      stopBackgroundLocationTracking().catch(() => {});
    };
  }, [shareLocation, isHydrated, clientId]);
}
