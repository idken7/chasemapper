import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView from 'react-native-maps';
import { ChaseMap, type MapMarkerDescriptor, type MapPolylineDescriptor } from '../../components/map/ChaseMap';
import { DoaCollapsedBadge } from '../../components/doa/DoaCollapsedBadge';
import { TrackFollowedCard } from './TrackFollowedCard';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useConnectionStore } from '../../store/connectionStore';
import { useRouteStore } from '../../store/routeStore';
import { useMobileStatePolling } from '../../api/useMobileState';
import { calculateLookAngles } from '../../utils/lookAngles';
import { altitudeUnitLabel, metersToDisplayAltitude, speedToDisplay, speedUnitLabel } from '../../utils/units';
import { MonoText } from '../../components/ui/Text';
import { colors, radii } from '../../theme/tokens';
import type { LatLonAlt } from '../../api/types';

const DEFAULT_REGION = {
  // Ann Arbor, MI — home base for UM's balloon program. Recentres once real
  // car/balloon telemetry arrives (see the effect below).
  latitude: 42.2808,
  longitude: -83.743,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

function toLatLng([lat, lon]: LatLonAlt) {
  return { latitude: lat, longitude: lon };
}

// GeoJSON coordinates are [lon, lat] — opposite order from the LatLonAlt telemetry
// tuples above. Matches RouteScreen's toLatLng().
function toLatLngFromGeoJson([lon, lat]: number[]) {
  return { latitude: lat, longitude: lon };
}

function toGeoPoint([lat, lon, alt]: LatLonAlt) {
  return { lat, lon, alt };
}

export function TrackScreen() {
  useMobileStatePolling(true);

  const insets = useSafeAreaInsets();
  const units = useSettingsStore((s) => s.units);
  const balloons = useTelemetryStore((s) => s.balloons);
  const target = useTelemetryStore((s) => s.target);
  const primaryCar = useTelemetryStore((s) => s.primaryCar);
  const ownCar = useTelemetryStore((s) => s.ownCar);
  const otherCars = useTelemetryStore((s) => s.otherCars);
  const manuallyFollowed = useTelemetryStore((s) => s.followedCallsign);
  const setFollowedCallsign = useTelemetryStore((s) => s.setFollowedCallsign);
  const connectionStatus = useConnectionStore((s) => s.status);
  const route = useRouteStore((s) => s.route);
  const routeAlternatives = useRouteStore((s) => s.alternatives);
  const routeSelectedLabel = useRouteStore((s) => s.selectedLabel);

  const mapRef = useRef<MapView>(null);
  const hasCenteredRef = useRef(false);

  const followedCallsign = manuallyFollowed ?? target?.callsign ?? Object.keys(balloons)[0] ?? null;
  const followedTrack = followedCallsign ? balloons[followedCallsign] : undefined;
  const followedTelem = followedTrack?.telem ?? (followedCallsign === target?.callsign ? target?.telemetry : null) ?? null;

  const carPosition = ownCar
    ? { lat: ownCar.position[0], lon: ownCar.position[1], alt: ownCar.position[2] }
    : primaryCar?.lat != null && primaryCar?.lon != null
      ? { lat: primaryCar.lat, lon: primaryCar.lon, alt: primaryCar.alt ?? 0 }
      : null;

  const distanceM = useMemo(() => {
    if (!carPosition || !followedTelem) return null;
    return calculateLookAngles(carPosition, toGeoPoint(followedTelem.position)).range;
  }, [carPosition, followedTelem]);

  const timeToLandingS = followedCallsign === target?.callsign ? (target?.time_to_landing_s ?? null) : null;

  const markers = useMemo<MapMarkerDescriptor[]>(() => {
    const list: MapMarkerDescriptor[] = [];

    Object.values(balloons).forEach((track) => {
      const { callsign, position, speed, vel_v } = track.telem;
      list.push({
        id: `balloon-${callsign}`,
        coordinate: toLatLng(position),
        kind: 'balloon',
        label: callsign,
        colour: track.colour,
        altitudeM: position[2],
        velV: vel_v,
        onPress: () => setFollowedCallsign(callsign),
        calloutTitle: callsign,
        calloutSubtitle:
          `ALT ${metersToDisplayAltitude(position[2], units).toFixed(0)}${altitudeUnitLabel(units)} · ` +
          `${speedToDisplay(speed, units).toFixed(0)}${speedUnitLabel(units)} · ` +
          `${vel_v >= 0 ? '+' : ''}${vel_v.toFixed(1)}m/s`,
      });
      if (track.predLanding) {
        list.push({
          id: `landing-${track.telem.callsign}`,
          coordinate: toLatLng(track.predLanding),
          kind: 'landing',
          colour: track.colour,
          calloutTitle: 'Predicted Landing',
          calloutSubtitle: `${callsign} · ${track.predLanding[0].toFixed(5)}, ${track.predLanding[1].toFixed(5)}`,
        });
      }
      if (track.burst) {
        list.push({
          id: `burst-${track.telem.callsign}`,
          coordinate: toLatLng(track.burst),
          kind: 'burst',
          calloutTitle: 'Predicted Burst',
          calloutSubtitle:
            `${callsign} · ALT ${metersToDisplayAltitude(track.burst[2], units).toFixed(0)}${altitudeUnitLabel(units)}`,
        });
      }
    });

    if (ownCar) {
      list.push({ id: 'own-car', coordinate: toLatLng(ownCar.position), kind: 'ownCar', headingDeg: ownCar.heading_valid ? ownCar.heading : null });
    } else if (primaryCar?.lat != null && primaryCar?.lon != null) {
      list.push({
        id: 'own-car',
        coordinate: { latitude: primaryCar.lat, longitude: primaryCar.lon },
        kind: 'ownCar',
        headingDeg: primaryCar.heading_valid ? primaryCar.heading : null,
      });
    }

    Object.entries(otherCars).forEach(([carId, car]) => {
      list.push({ id: `chaser-${carId}`, coordinate: toLatLng(car.position), kind: 'chaser', headingDeg: car.heading_valid ? car.heading : null });
    });

    return list;
  }, [balloons, ownCar, primaryCar, otherCars, setFollowedCallsign, units]);

  const polylines = useMemo<MapPolylineDescriptor[]>(() => {
    const list: MapPolylineDescriptor[] = [];
    Object.values(balloons).forEach((track) => {
      if (track.path.length > 1) {
        list.push({ id: `path-${track.telem.callsign}`, coordinates: track.path.map(toLatLng), kind: 'path' });
      }
      // The predictor computes pred_path/abort_path from whatever position it last
      // ran on, which can lag behind the balloon's live telemetry — anchoring the
      // drawn line to the current marker position keeps it visually attached instead
      // of floating off with a gap.
      if (track.predPath.length > 1) {
        list.push({
          id: `pred-${track.telem.callsign}`,
          coordinates: [toLatLng(track.telem.position), ...track.predPath.map(toLatLng)],
          kind: 'predicted',
        });
      }
      if (track.abortPath.length > 1) {
        list.push({
          id: `abort-${track.telem.callsign}`,
          coordinates: [toLatLng(track.telem.position), ...track.abortPath.map(toLatLng)],
          kind: 'abort',
        });
      }
    });

    // The active drive-to-recover route, so it's visible on the main map (not just
    // the separate Route tab) — this is what actually gets a chaser to the payload;
    // the dashed prediction line above is a wind-drift forecast, not a driving route.
    const activeAlternative = routeAlternatives
      ? (routeAlternatives.find((a) => a.label === routeSelectedLabel) ?? routeAlternatives[0])
      : null;
    const routeGeometry = activeAlternative?.feature ?? route?.geojson ?? null;
    if (routeGeometry && routeGeometry.geometry.coordinates.length > 1) {
      list.push({
        id: 'active-route',
        coordinates: routeGeometry.geometry.coordinates.map(toLatLngFromGeoJson),
        kind: 'route',
      });
    }

    return list;
  }, [balloons, route, routeAlternatives, routeSelectedLabel]);

  useEffect(() => {
    if (hasCenteredRef.current) return;
    const centerOn = followedTelem?.position ?? (carPosition ? ([carPosition.lat, carPosition.lon, carPosition.alt] as LatLonAlt) : null);
    if (!centerOn) return;
    hasCenteredRef.current = true;
    mapRef.current?.animateToRegion({ ...toLatLng(centerOn), latitudeDelta: 0.3, longitudeDelta: 0.3 }, 500);
  }, [followedTelem, carPosition]);

  return (
    <View style={styles.container}>
      <ChaseMap ref={mapRef} initialRegion={DEFAULT_REGION} markers={markers} polylines={polylines} />
      <View style={[styles.topOverlay, { top: insets.top + 12 }]} pointerEvents="none">
        <View style={styles.brandMark}>
          <MonoText style={styles.brandMarkText}>CD</MonoText>
        </View>
        {connectionStatus === 'connected' && (
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <MonoText style={styles.liveLabel}>LIVE</MonoText>
          </View>
        )}
      </View>
      <DoaCollapsedBadge />
      {followedTelem && (
        <View style={styles.cardWrap}>
          <TrackFollowedCard telem={followedTelem} distanceM={distanceM} timeToLandingS={timeToLandingS} units={units} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  cardWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
  },
  topOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  brandMark: {
    width: 24,
    height: 24,
    borderRadius: 5,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkText: {
    color: colors.accentText,
    fontWeight: '700',
    fontSize: 12,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.trackBlue,
  },
  liveLabel: {
    fontSize: 10.5,
    color: colors.telemetryBlue,
  },
});
