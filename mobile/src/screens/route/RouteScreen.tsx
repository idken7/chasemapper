import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView from 'react-native-maps';
import Svg, { Path } from 'react-native-svg';
import { ChaseMap, type MapMarkerDescriptor, type MapPolylineDescriptor } from '../../components/map/ChaseMap';
import { RouteTurnIcon } from '../../components/route/RouteTurnIcon';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { HeadingText, MonoText } from '../../components/ui/Text';
import { useRouteStore } from '../../store/routeStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useBottomSheetStore } from '../../store/bottomSheetStore';
import { formatDistance, formatDurationS } from '../../utils/format';
import { cumulativeDistances, distanceAlongRoute, type LatLng } from '../../utils/routeProgress';
import { colors, fonts, radii, spacing } from '../../theme/tokens';
import type { RouteStep } from '../../api/types';

const DEFAULT_REGION = {
  latitude: 42.2808,
  longitude: -83.743,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

// Close-up span for navigate mode — tight enough to read like a normal
// turn-by-turn view rather than the whole-route overview.
const NAVIGATE_DELTA = 0.008;

function stepHeadline(step: RouteStep): string {
  if (step.type === 'arrive') return 'Arrive near balloon (est.)';
  if (step.modifier?.includes('left')) return step.name ? `Turn left onto ${step.name}` : 'Turn left';
  if (step.modifier?.includes('right')) return step.name ? `Turn right onto ${step.name}` : 'Turn right';
  if (step.type === 'depart') return step.name ? `Head out on ${step.name}` : 'Head out';
  return step.name ? `Continue on ${step.name}` : 'Continue straight';
}

function describeManeuver(step: RouteStep | undefined): string | null {
  if (!step) return null;
  if (step.type === 'arrive') return 'arrive';
  if (step.modifier?.includes('left')) return 'turn left';
  if (step.modifier?.includes('right')) return 'turn right';
  return 'continue straight';
}

function toLatLng([lon, lat]: number[]): LatLng {
  return { latitude: lat, longitude: lon };
}

export function RouteScreen() {
  const insets = useSafeAreaInsets();
  const route = useRouteStore((s) => s.route);
  const eta = useRouteStore((s) => s.eta);
  const alternatives = useRouteStore((s) => s.alternatives);
  const selectedLabel = useRouteStore((s) => s.selectedLabel);
  const routeTargetCallsign = useRouteStore((s) => s.targetCallsign);
  const selectAlternative = useRouteStore((s) => s.selectAlternative);
  const clearRoute = useRouteStore((s) => s.clearRoute);

  const balloons = useTelemetryStore((s) => s.balloons);
  const target = useTelemetryStore((s) => s.target);
  const manuallyFollowed = useTelemetryStore((s) => s.followedCallsign);
  const ownCar = useTelemetryStore((s) => s.ownCar);
  const primaryCar = useTelemetryStore((s) => s.primaryCar);
  const units = useSettingsStore((s) => s.units);
  const openStartRouting = useBottomSheetStore((s) => s.openStartRouting);

  const [expanded, setExpanded] = useState(false);
  const [passedCollapsed, setPassedCollapsed] = useState(true);
  const [viewMode, setViewMode] = useState<'overview' | 'navigate'>('overview');
  const mapRef = useRef<MapView>(null);

  const followedCallsign = manuallyFollowed ?? target?.callsign ?? Object.keys(balloons)[0] ?? null;
  const targetLabel = routeTargetCallsign ?? target?.callsign ?? followedCallsign;
  const targetTrack = targetLabel ? balloons[targetLabel] : undefined;
  const targetTelem = targetTrack?.telem ?? (targetLabel === target?.callsign ? target?.telemetry : null) ?? null;

  const active = alternatives ? (alternatives.find((a) => a.label === selectedLabel) ?? alternatives[0]) : null;
  const distanceM = active?.distance_m ?? route?.distance_m ?? null;
  const durationS = active?.duration_s ?? route?.duration_s ?? null;
  const steps = active?.steps ?? route?.steps ?? null;
  const geometry = active?.feature ?? route?.geojson ?? null;
  const hasRoute = distanceM != null && !!steps && steps.length > 0;

  const balloonEtaS =
    targetLabel && target?.callsign === targetLabel ? target?.time_to_landing_s ?? null : eta?.payload_time_to_landing_s ?? null;

  const polylineCoords = useMemo(
    () => (geometry ? geometry.geometry.coordinates.map(toLatLng) : []),
    [geometry]
  );
  const cumulative = useMemo(() => cumulativeDistances(polylineCoords), [polylineCoords]);

  const carLatLng = useMemo<LatLng | null>(() => {
    if (ownCar) return { latitude: ownCar.position[0], longitude: ownCar.position[1] };
    if (primaryCar?.lat != null && primaryCar?.lon != null) {
      return { latitude: primaryCar.lat, longitude: primaryCar.lon };
    }
    return null;
  }, [ownCar, primaryCar]);

  // Falls back to the route's start point when there's no live car telemetry yet
  // (ownCar only appears once GPS has round-tripped through the server) — otherwise
  // navigate mode would have nowhere to zoom in on.
  const navigateTarget = carLatLng ?? (polylineCoords.length > 0 ? polylineCoords[0] : null);

  const carDistanceAlongRoute = useMemo(
    () => (carLatLng && polylineCoords.length > 1 ? distanceAlongRoute(carLatLng, polylineCoords, cumulative) : null),
    [carLatLng, polylineCoords, cumulative]
  );

  // A step is "passed" once the car's own distance-along-route has gone beyond that
  // step's location. Falls back to just marking the first non-depart step as "next"
  // (matching the old behaviour) when there's no car position or the step has no
  // location, e.g. OSRM omitted it.
  const passedFlags = useMemo(() => {
    if (!steps) return [];
    return steps.map((step) => {
      if (carDistanceAlongRoute == null || !step.location || polylineCoords.length < 2) return false;
      const stepDistance = distanceAlongRoute(toLatLng(step.location), polylineCoords, cumulative);
      return stepDistance != null && stepDistance < carDistanceAlongRoute;
    });
  }, [steps, carDistanceAlongRoute, polylineCoords, cumulative]);

  const nextStepIndex = useMemo(() => {
    if (!steps) return -1;
    // Only trust the progress-based passed flags once we actually have a car
    // position to derive them from — otherwise every step reads as "not passed"
    // and this would wrongly pick the depart step instead of falling through.
    if (carDistanceAlongRoute != null) {
      const firstUnpassed = passedFlags.findIndex((passed) => !passed);
      if (firstUnpassed >= 0) return firstUnpassed;
    }
    const idx = steps.findIndex((s) => s.type !== 'depart');
    return idx >= 0 ? idx : 0;
  }, [steps, passedFlags, carDistanceAlongRoute]);
  const nextStep = steps && nextStepIndex >= 0 ? steps[nextStepIndex] : null;
  const followingManeuver = steps ? describeManeuver(steps[nextStepIndex + 1]) : null;
  const polylines = useMemo<MapPolylineDescriptor[]>(
    () => (polylineCoords.length > 1 ? [{ id: 'route-line', coordinates: polylineCoords, kind: 'route' }] : []),
    [polylineCoords]
  );
  const markers = useMemo<MapMarkerDescriptor[]>(() => {
    if (polylineCoords.length === 0) return [];
    return [
      { id: 'route-start', coordinate: polylineCoords[0], kind: 'ownCar' },
      { id: 'route-end', coordinate: polylineCoords[polylineCoords.length - 1], kind: 'balloon' },
    ];
  }, [polylineCoords]);

  useEffect(() => {
    if (viewMode === 'overview' && polylineCoords.length > 1) {
      mapRef.current?.fitToCoordinates(polylineCoords, {
        edgePadding: { top: 60, right: 40, bottom: 160, left: 40 },
        animated: true,
      });
    }
  }, [viewMode, polylineCoords]);

  // Navigate mode: instead of the whole-route overview above, keep the camera
  // tight on the car so it reads like a normal turn-by-turn nav view — re-centers
  // as the car moves rather than only on the initial fit.
  useEffect(() => {
    if (viewMode === 'navigate' && navigateTarget) {
      mapRef.current?.animateToRegion(
        { ...navigateTarget, latitudeDelta: NAVIGATE_DELTA, longitudeDelta: NAVIGATE_DELTA },
        450
      );
    }
  }, [viewMode, navigateTarget]);

  if (!hasRoute) {
    return (
      <ScreenContainer style={styles.emptyContainer}>
        <HeadingText style={styles.emptyTitle}>No active route</HeadingText>
        <MonoText style={styles.emptySubtitle}>Start routing to a tracked balloon to see turn-by-turn directions here.</MonoText>
        <TouchableOpacity
          style={[styles.startCta, !followedCallsign && styles.startCtaDisabled]}
          onPress={() => followedCallsign && openStartRouting(followedCallsign)}
          disabled={!followedCallsign}
        >
          <MonoText style={styles.startCtaLabel}>Start Routing</MonoText>
        </TouchableOpacity>
      </ScreenContainer>
    );
  }

  return (
    <View style={styles.container}>
      {!expanded && (
        <View style={styles.mapWrap}>
          <ChaseMap ref={mapRef} initialRegion={DEFAULT_REGION} markers={markers} polylines={polylines} />
          <TouchableOpacity
            style={[styles.viewToggle, { top: insets.top + 86 }]}
            onPress={() => setViewMode((m) => (m === 'overview' ? 'navigate' : 'overview'))}
          >
            <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              {viewMode === 'overview' ? (
                <Path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              ) : (
                <Path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
              )}
            </Svg>
            <MonoText style={styles.viewToggleLabel}>{viewMode === 'overview' ? 'Overview' : 'Navigate'}</MonoText>
          </TouchableOpacity>
        </View>
      )}

      {nextStep && (
        <TouchableOpacity
          style={[
            styles.heroHeader,
            { paddingTop: insets.top + 20 },
            expanded ? styles.heroHeaderStatic : styles.heroHeaderOverlay,
            expanded && styles.heroHeaderExpanded,
          ]}
          activeOpacity={0.85}
          onPress={() => setExpanded((e) => !e)}
        >
          <View style={[styles.heroIcon, expanded && styles.heroIconExpanded]}>
            <RouteTurnIcon step={nextStep} size={expanded ? 16 : 18} color={colors.bg} />
          </View>
          <View style={styles.heroText}>
            <MonoText style={[styles.heroTitle, expanded && styles.heroTitleExpanded]}>{stepHeadline(nextStep)}</MonoText>
            <MonoText style={[styles.heroSubtitle, expanded && styles.heroSubtitleExpanded]}>
              for {formatDistance(nextStep.distance_m, units)}
              {followingManeuver ? ` · then ${followingManeuver}` : ''}
            </MonoText>
          </View>
          <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={colors.bg} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <Path d={expanded ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} />
          </Svg>
        </TouchableOpacity>
      )}

      {expanded && (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {alternatives && alternatives.length > 1 && (
            <View style={styles.altRow}>
              {alternatives.map((alt) => (
                <TouchableOpacity
                  key={alt.label}
                  style={[styles.altPill, selectedLabel === alt.label && styles.altPillActive]}
                  onPress={() => selectAlternative(alt.label)}
                >
                  <MonoText style={[styles.altLabel, selectedLabel === alt.label && styles.altLabelActive]}>
                    {alt.label === 'fastest' ? 'Fastest' : 'Shortest'} · {formatDurationS(alt.duration_s)}
                  </MonoText>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {nextStepIndex > 0 && (
            <TouchableOpacity style={styles.passedRow} onPress={() => setPassedCollapsed((c) => !c)}>
              <MonoText style={styles.passedLabel}>{nextStepIndex} stop{nextStepIndex === 1 ? '' : 's'} passed</MonoText>
              <Svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="rgba(230,238,246,0.4)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <Path d={passedCollapsed ? 'M9 6l6 6-6 6' : 'M6 9l6 6 6-6'} />
              </Svg>
            </TouchableOpacity>
          )}
          {steps?.map((step, i) => {
            const isNext = i === nextStepIndex;
            const isPassed = i < nextStepIndex;
            if (isPassed && passedCollapsed) return null;
            return (
              <View
                key={i}
                style={[styles.turnRow, isNext && styles.turnRowNext, isPassed && styles.turnRowPassed]}
              >
                <View style={[styles.turnIconWrap, isNext && styles.turnIconWrapNext]}>
                  <RouteTurnIcon step={step} size={14} color={isNext ? colors.accent : colors.text} />
                </View>
                <MonoText style={[styles.turnText, isNext && styles.turnTextNext]} numberOfLines={1}>
                  {stepHeadline(step)}
                </MonoText>
                <MonoText style={[styles.turnDist, isNext && styles.turnDistNext]}>
                  {formatDistance(step.distance_m, units)}
                </MonoText>
              </View>
            );
          })}
        </ScrollView>
      )}

      <View style={[styles.footer, expanded ? styles.footerStatic : styles.footerOverlay, expanded && styles.footerExpanded]}>
        <View style={styles.footerHeader}>
          <MonoText style={[styles.footerCallsign, expanded && styles.footerCallsignExpanded]}>{targetLabel}</MonoText>
          <View style={styles.footerHeaderRight}>
            {targetTelem && (
              <MonoText style={styles.footerAltDesc}>
                ALT {formatDistance(targetTelem.position[2], units)} · {targetTelem.vel_v.toFixed(1)}m/s
              </MonoText>
            )}
            <TouchableOpacity onPress={clearRoute} hitSlop={8}>
              <MonoText style={styles.footerStop}>Stop</MonoText>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.footerStats}>
          <View>
            <MonoText style={[styles.footerLabel, expanded && styles.footerLabelExpanded]}>DRIVE ETA</MonoText>
            <HeadingText style={[styles.footerValue, expanded && styles.footerValueExpanded, { color: colors.telemetryBlue }]}>
              {durationS != null ? formatDurationS(durationS) : '—'}
            </HeadingText>
          </View>
          <View style={styles.footerRight}>
            <MonoText style={[styles.footerLabel, expanded && styles.footerLabelExpanded]}>BALLOON ETA</MonoText>
            <HeadingText style={[styles.footerValue, expanded && styles.footerValueExpanded, { color: colors.accent }]}>
              {balloonEtaS != null ? formatDurationS(balloonEtaS) : '—'}
            </HeadingText>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  // Full-bleed like Track (M1/M2): ChaseMap renders its MapView with
  // StyleSheet.absoluteFill, so this wrapper filling the whole screen is what makes
  // it edge-to-edge, with the header/footer overlaid on top via position:'absolute'
  // rather than squeezed into a flex slot between them.
  mapWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  viewToggle: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(10,13,22,0.85)',
    borderWidth: 1,
    borderColor: colors.borderAccent,
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingLeft: 8,
    paddingRight: 10,
  },
  viewToggleLabel: { fontSize: 10.5, fontWeight: '600', color: colors.text },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl },
  emptyTitle: { fontSize: 18 },
  emptySubtitle: { fontSize: 12.5, color: colors.textMuted, textAlign: 'center' },
  startCta: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
  },
  startCtaDisabled: { opacity: 0.4 },
  startCtaLabel: { color: colors.accentText, fontWeight: '700', fontSize: 13 },

  // Base = collapsed/map state (M2: 84px-tall hero, no chevron). Expanded/list
  // state (M9) shrinks via heroHeaderExpanded overrides and adds a bare chevron.
  // paddingTop is applied inline (insets.top + 20) since it must react to the
  // device's safe area rather than a fixed guess.
  heroHeader: {
    paddingBottom: 20,
    paddingHorizontal: 18,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  // Collapsed/map mode: overlays the full-bleed map like Track's topOverlay.
  heroHeaderOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
  },
  // Expanded/list mode: no map underneath, so it's just the first item in normal flow.
  heroHeaderStatic: {},
  heroHeaderExpanded: {
    paddingBottom: 12,
  },
  heroIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: 'rgba(10,13,22,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIconExpanded: {
    width: 32,
    height: 32,
  },
  heroText: { flex: 1 },
  heroTitle: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 16, color: colors.bg },
  heroTitleExpanded: { fontSize: 15 },
  heroSubtitle: { fontSize: 11.5, color: 'rgba(10,13,22,0.7)', marginTop: 2 },
  heroSubtitleExpanded: { fontSize: 11 },

  list: { flex: 1, marginTop: 10 },
  listContent: { paddingHorizontal: 12, paddingBottom: 24, gap: 6 },
  altRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  altPill: { paddingVertical: 6, paddingHorizontal: 11, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)' },
  altPillActive: { backgroundColor: colors.accent },
  altLabel: { fontSize: 10.5, fontWeight: '700', color: 'rgba(230,238,246,0.6)' },
  altLabelActive: { color: colors.accentText },
  passedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  passedLabel: { fontSize: 10.5, color: 'rgba(230,238,246,0.45)' },
  turnRow: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 9, borderRadius: 10 },
  turnRowNext: { backgroundColor: 'rgba(255,203,5,0.09)', borderWidth: 1, borderColor: 'rgba(255,203,5,0.25)' },
  turnRowPassed: { opacity: 0.55 },
  turnIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  turnIconWrapNext: { backgroundColor: 'rgba(255,203,5,0.16)' },
  turnText: { flex: 1, fontSize: 11.5, fontWeight: '600', color: colors.text },
  turnTextNext: { fontWeight: '700' },
  turnDist: { fontSize: 10, color: 'rgba(230,238,246,0.45)' },
  turnDistNext: { color: colors.accent },

  // Base = collapsed/map state (M2: 16px padding, larger type). Expanded/list
  // state (M9) shrinks via footerExpanded overrides.
  footer: {
    padding: 16,
    borderRadius: radii.xl,
    backgroundColor: 'rgba(18,23,40,0.92)',
    borderWidth: 1,
    borderColor: colors.borderAccent,
  },
  // Collapsed/map mode: overlays the full-bleed map like Track's cardWrap.
  footerOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
  },
  // Expanded/list mode: no map underneath, so it's just the last item in normal flow.
  footerStatic: {
    margin: 12,
  },
  footerExpanded: {
    padding: 14,
  },
  footerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingBottom: 10,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  footerCallsign: { color: colors.accent, fontWeight: '700', fontSize: 12.5 },
  footerCallsignExpanded: { fontSize: 11.5 },
  footerHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  footerAltDesc: { color: colors.textMuted, fontSize: 11 },
  footerStop: { color: colors.dangerText, fontWeight: '700', fontSize: 11 },
  footerStats: { flexDirection: 'row', justifyContent: 'space-between' },
  footerRight: { alignItems: 'flex-end' },
  footerLabel: { fontSize: 10, color: colors.textMuted, letterSpacing: 0.5, marginBottom: 2 },
  footerLabelExpanded: { fontSize: 9.5 },
  footerValue: { fontSize: 21 },
  footerValueExpanded: { fontSize: 19 },
});
