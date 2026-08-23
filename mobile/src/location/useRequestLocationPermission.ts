import { useEffect } from 'react';
import * as Location from 'expo-location';

/**
 * Requests foreground location permission once on launch so ChaseMap's native
 * "blue dot" (showsUserLocation) can appear immediately, rather than only after the
 * user first visits a screen that happens to ask for permission (Start Routing's
 * "My GPS" option, or Settings' "Share my live location" toggle).
 */
export function useRequestLocationPermission() {
  useEffect(() => {
    Location.requestForegroundPermissionsAsync().catch(() => {});
  }, []);
}
