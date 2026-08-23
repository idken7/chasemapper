import { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { ChaseMap, type MapMarkerDescriptor, type MapPolylineDescriptor } from '../../components/map/ChaseMap';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { Card } from '../../components/ui/Card';
import { MonoText } from '../../components/ui/Text';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useConfigStore } from '../../store/configStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useBottomSheetStore } from '../../store/bottomSheetStore';
import { useAprsStore } from '../../store/aprsStore';
import { emitAprsCallsignRemove, emitAprsRefreshRequest } from '../../api/socket';
import { calculateLookAngles, type GeoPoint } from '../../utils/lookAngles';
import { formatDistance, formatDurationS } from '../../utils/format';
import {
  altitudeUnitLabel,
  metersToDisplayAltitude,
  speedToDisplay,
  speedUnitLabel,
  verticalRateToDisplay,
  verticalRateUnitLabel,
} from '../../utils/units';
import { colors, spacing } from '../../theme/tokens';
import type { AprsStackParamList } from '../../navigation/types';
import type { LatLonAlt } from '../../api/types';

type Props = NativeStackScreenProps<AprsStackParamList, 'CallsignDetail'>;

function formatLatLon([lat, lon]: LatLonAlt): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <MonoText style={styles.detailLabel}>{label}</MonoText>
      <MonoText style={styles.detailValue}>{value}</MonoText>
    </View>
  );
}

export function CallsignDetailScreen({ route }: Props) {
  const { callsign } = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<AprsStackParamList>>();
  const openPredictionSettings = useBottomSheetStore((s) => s.openPredictionSettings);
  const openMarkRecovered = useBottomSheetStore((s) => s.openMarkRecovered);
  const startRefreshing = useAprsStore((s) => s.startRefreshing);

  const track = useTelemetryStore((s) => s.balloons[callsign]);
  const target = useTelemetryStore((s) => s.target);
  const ownCar = useTelemetryStore((s) => s.ownCar);
  const primaryCar = useTelemetryStore((s) => s.primaryCar);
  const config = useConfigStore((s) => s.config);
  const units = useSettingsStore((s) => s.units);

  const referencePosition = useMemo<GeoPoint | null>(() => {
    if (ownCar) return { lat: ownCar.position[0], lon: ownCar.position[1], alt: ownCar.position[2] };
    if (primaryCar?.lat != null && primaryCar?.lon != null) {
      return { lat: primaryCar.lat, lon: primaryCar.lon, alt: primaryCar.alt ?? 0 };
    }
    const defaultLat = config?.default_lat as number | undefined;
    const defaultLon = config?.default_lon as number | undefined;
    if (defaultLat != null && defaultLon != null) return { lat: defaultLat, lon: defaultLon, alt: 0 };
    return null;
  }, [ownCar, primaryCar, config]);

  if (!track) {
    return (
      <ScreenContainer style={styles.empty}>
        <MonoText style={{ color: colors.textMuted }}>No telemetry received yet for {callsign}</MonoText>
      </ScreenContainer>
    );
  }

  const { telem, predPath, predLanding, burst, abortLanding, predictorUpdatedAt } = track;
  const ageS = Date.now() / 1000 - telem.server_time;
  const isFresh = ageS <= 60;

  const lookAngles = referencePosition
    ? calculateLookAngles(referencePosition, { lat: telem.position[0], lon: telem.position[1], alt: telem.position[2] })
    : null;

  const override = config?.aprs_prediction_overrides?.[callsign];
  const descentRate = override?.pred_desc_rate ?? (config?.pred_desc_rate as number | undefined) ?? null;

  // ETA to landing: prefer the server's own computation when this is its chosen
  // target (most accurate — accounts for full descent-path integration); otherwise
  // fall back to a simple altitude/descent-rate estimate for the followed balloon.
  let etaToLandingLabel = '—';
  if (target?.callsign === callsign && target.time_to_landing_s != null) {
    etaToLandingLabel = formatDurationS(target.time_to_landing_s);
  } else if (telem.vel_v < 0 && descentRate) {
    etaToLandingLabel = formatDurationS(telem.position[2] / Math.abs(descentRate));
  }

  const landingRangeM = referencePosition && predLanding
    ? calculateLookAngles(referencePosition, { lat: predLanding[0], lon: predLanding[1], alt: predLanding[2] }).range
    : null;

  const mapMarkers: MapMarkerDescriptor[] = [
    {
      id: 'balloon',
      coordinate: { latitude: telem.position[0], longitude: telem.position[1] },
      kind: 'balloon',
      colour: track.colour,
      altitudeM: telem.position[2],
      velV: telem.vel_v,
    },
  ];
  const mapPolylines: MapPolylineDescriptor[] =
    track.path.length > 1
      ? [{ id: 'path', coordinates: track.path.map(([lat, lon]) => ({ latitude: lat, longitude: lon })), kind: 'path' }]
      : [];

  return (
    <ScreenContainer>
      <View style={styles.mapStrip}>
        <ChaseMap
          initialRegion={{
            latitude: telem.position[0],
            longitude: telem.position[1],
            latitudeDelta: 0.15,
            longitudeDelta: 0.15,
          }}
          markers={mapMarkers}
          polylines={mapPolylines}
        />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <MonoText style={styles.groupTitle}>Telemetry</MonoText>
          <Row label="Freshness" value={isFresh ? `Fresh (${Math.round(ageS)}s ago)` : `Stale (${Math.round(ageS)}s ago)`} />
          <Row label="Position" value={formatLatLon(telem.position)} />
          <Row label="Altitude" value={`${metersToDisplayAltitude(telem.position[2], units).toFixed(0)}${altitudeUnitLabel(units)}`} />
          <Row label="Speed" value={`${speedToDisplay(telem.speed, units).toFixed(0)}${speedUnitLabel(units)}`} />
          <Row label="Ascent" value={`${verticalRateToDisplay(telem.vel_v, units).toFixed(1)}${verticalRateUnitLabel(units)}`} />
          {lookAngles && <Row label="Range" value={formatDistance(lookAngles.range, units)} />}
          {lookAngles && <Row label="Azimuth" value={`${lookAngles.azimuth.toFixed(0)}°`} />}
          {lookAngles && <Row label="Elevation" value={`${lookAngles.elevation.toFixed(0)}°`} />}
        </Card>

        <Card style={styles.card}>
          <MonoText style={styles.groupTitle}>Prediction</MonoText>
          <Row
            label="Prediction Age"
            value={predictorUpdatedAt ? `${Math.round((Date.now() - predictorUpdatedAt) / 1000)}s ago` : '—'}
          />
          <Row label="Pred Path Points" value={String(predPath.length)} />
          <Row label="Max Altitude" value={`${metersToDisplayAltitude(telem.max_alt, units).toFixed(0)}${altitudeUnitLabel(units)}`} />
          <Row label="Descent TTL" value={telem.time_to_landing || '—'} />
          <Row label="ETA To Landing" value={etaToLandingLabel} />
        </Card>

        <Card style={styles.card}>
          <MonoText style={styles.groupTitle}>Landing</MonoText>
          <Row label="Landing Estimate" value={predLanding ? formatLatLon(predLanding) : '—'} />
          <Row label="Landing Range" value={landingRangeM !== null ? formatDistance(landingRangeM, units) : '—'} />
          <Row label="Burst Estimate" value={burst ? formatLatLon(burst) : '—'} />
          <Row label="Abort Landing" value={abortLanding ? formatLatLon(abortLanding) : '—'} />
        </Card>

        <View style={styles.actionGrid}>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => {
                startRefreshing(callsign);
                emitAprsRefreshRequest(callsign);
              }}
            >
              <MonoText style={styles.actionLabel}>Force Refresh</MonoText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={() => openPredictionSettings(callsign)}>
              <MonoText style={styles.actionLabel}>Prediction Settings</MonoText>
            </TouchableOpacity>
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionButtonAccent} onPress={() => openMarkRecovered(callsign)}>
              <MonoText style={styles.actionLabelAccent}>Mark Recovered</MonoText>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionButtonDanger}
              onPress={() => {
                emitAprsCallsignRemove(callsign);
                navigation.goBack();
              }}
            >
              <MonoText style={styles.actionLabelDanger}>Remove</MonoText>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapStrip: {
    height: 150,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  card: {
    gap: spacing.xs,
  },
  groupTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: 12.5,
  },
  detailValue: {
    color: colors.text,
    fontSize: 12.5,
  },
  actionGrid: {
    gap: spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  // Fixed height (rather than content-driven paddingVertical) so all four cells
  // stay uniform regardless of label length — "Prediction Settings" wrapping to
  // two lines shouldn't make its row taller than "Force Refresh"'s. flexBasis: 0
  // (not flex:1's default 'auto') does the same for width — with basis:'auto', Yoga
  // sizes each button to its own label first ("Prediction Settings" >> "Force
  // Refresh", "Mark Recovered" >> "Remove") and only splits leftover space,
  // producing a lopsided grid instead of an even 2x2.
  actionButton: {
    flex: 1,
    flexBasis: 0,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  actionLabel: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 11.5,
    textAlign: 'center',
  },
  actionButtonAccent: {
    flex: 1,
    flexBasis: 0,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: colors.accentDim,
  },
  actionLabelAccent: {
    color: colors.accent,
    fontWeight: '600',
    fontSize: 11.5,
    textAlign: 'center',
  },
  actionButtonDanger: {
    flex: 1,
    flexBasis: 0,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: 'rgba(224,90,90,0.14)',
  },
  actionLabelDanger: {
    color: colors.dangerText,
    fontWeight: '600',
    fontSize: 11.5,
    textAlign: 'center',
  },
});
