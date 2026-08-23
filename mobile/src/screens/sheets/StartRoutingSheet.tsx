import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import { HeadingText, MonoText } from '../../components/ui/Text';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useRouteStore } from '../../store/routeStore';
import { ApiError, postRoute } from '../../api/client';
import { colors, fonts, radii, spacing } from '../../theme/tokens';

type StartPoint = 'chaseCar' | 'myGps' | 'manual';
type Preference = 'fastest' | 'shortest';

type Props = {
  targetCallsign: string;
  onDone: () => void;
};

// M12 — sheet, start routing.
export function StartRoutingSheet({ targetCallsign, onDone }: Props) {
  const ownCar = useTelemetryStore((s) => s.ownCar);
  const primaryCar = useTelemetryStore((s) => s.primaryCar);
  const target = useTelemetryStore((s) => s.balloons[targetCallsign]);
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const apiKey = useSettingsStore((s) => s.apiKey);
  const clientId = useSettingsStore((s) => s.clientId);
  const setAlternatives = useRouteStore((s) => s.setAlternatives);
  const selectAlternative = useRouteStore((s) => s.selectAlternative);

  const [startPoint, setStartPoint] = useState<StartPoint>('chaseCar');
  const [preference, setPreference] = useState<Preference>('fastest');
  const [manualLat, setManualLat] = useState('');
  const [manualLon, setManualLon] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // This device's own GPS fix, queried live — used both for the explicit "My GPS"
  // option and as "Chase Car"'s fallback (see getStartPosition below) so a personal
  // route always starts from where the phone actually is, not from primaryCar (a
  // single hardware GPS shared by every client connected to the server, which may
  // belong to a different vehicle entirely).
  async function getDeviceGpsPosition(): Promise<{ lat: number; lon: number } | null> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== Location.PermissionStatus.GRANTED) return null;
    const loc = await Location.getCurrentPositionAsync({});
    return { lat: loc.coords.latitude, lon: loc.coords.longitude };
  }

  const handleStart = async () => {
    if (!target) return;
    setError(null);

    if (!clientId) {
      setError('Still starting up — try again in a moment');
      return;
    }

    let start: { lat: number; lon: number } | null = null;
    setSubmitting(true);
    try {
      if (startPoint === 'manual') {
        const lat = Number(manualLat);
        const lon = Number(manualLon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          start = { lat, lon };
        } else {
          setError('Enter a valid latitude and longitude');
        }
      } else if (startPoint === 'myGps') {
        try {
          start = await getDeviceGpsPosition();
          if (!start) setError('Location permission denied');
        } catch {
          setError('Could not get your location');
        }
      } else {
        // 'chaseCar': prefer this device's own GPS (ownCar once shared, else a
        // fresh query) and only fall back to the shared hardware GPS as a last
        // resort, so this never silently routes from an unrelated vehicle.
        if (ownCar != null) {
          start = { lat: ownCar.position[0], lon: ownCar.position[1] };
        } else {
          try {
            start = await getDeviceGpsPosition();
          } catch {
            start = null;
          }
        }
        if (!start && primaryCar?.lat != null && primaryCar?.lon != null) {
          start = { lat: primaryCar.lat, lon: primaryCar.lon };
        }
        if (!start) setError('No chase car position available yet');
      }
    } finally {
      if (!start) setSubmitting(false);
    }

    if (!start) return;

    // Route to the predicted landing point, not the balloon's current in-flight
    // position — while airborne that's mid-air and unreachable by road. Falls back
    // to the live position only if no landing prediction has arrived yet.
    const end = target.predLanding ?? target.telem.position;

    try {
      const response = await postRoute(serverUrl, apiKey, {
        start_lat: start.lat,
        start_lon: start.lon,
        end_lat: end[0],
        end_lon: end[1],
        client_id: clientId,
      });
      setAlternatives(response.alternatives, targetCallsign, startPoint, startPoint === 'manual' ? start : null);
      selectAlternative(preference);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Route computation failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <HeadingText style={styles.title}>Start Routing</HeadingText>
      <MonoText style={styles.subtitle}>
        to {targetCallsign} ({target?.predLanding ? 'predicted landing' : 'live balloon position'})
      </MonoText>

      <MonoText style={styles.fieldLabel}>Start point</MonoText>
      <View style={styles.segmented}>
        {(['chaseCar', 'myGps', 'manual'] as StartPoint[]).map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.segment, startPoint === option && styles.segmentActive]}
            onPress={() => setStartPoint(option)}
          >
            <MonoText style={[styles.segmentLabel, startPoint === option && styles.segmentLabelActive]}>
              {option === 'chaseCar' ? 'Chase Car' : option === 'myGps' ? 'My GPS' : 'Manual'}
            </MonoText>
          </TouchableOpacity>
        ))}
      </View>

      {startPoint === 'manual' && (
        <View style={styles.manualRow}>
          <TextInput
            style={styles.manualInput}
            value={manualLat}
            onChangeText={setManualLat}
            placeholder="Latitude"
            placeholderTextColor={colors.textFaint}
            keyboardType="numbers-and-punctuation"
          />
          <TextInput
            style={styles.manualInput}
            value={manualLon}
            onChangeText={setManualLon}
            placeholder="Longitude"
            placeholderTextColor={colors.textFaint}
            keyboardType="numbers-and-punctuation"
          />
        </View>
      )}

      <MonoText style={styles.fieldLabel}>Route preference</MonoText>
      <View style={styles.prefRow}>
        {(['fastest', 'shortest'] as Preference[]).map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.prefPill, preference === option && styles.prefPillActive]}
            onPress={() => setPreference(option)}
          >
            <MonoText style={[styles.prefLabel, preference === option && styles.prefLabelActive]}>
              {option === 'fastest' ? 'Fastest' : 'Shortest'}
            </MonoText>
          </TouchableOpacity>
        ))}
      </View>

      {error && <MonoText style={styles.error}>{error}</MonoText>}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelButton} onPress={onDone} disabled={submitting}>
          <MonoText style={styles.cancelLabel}>Cancel</MonoText>
        </TouchableOpacity>
        <TouchableOpacity style={styles.startButton} onPress={handleStart} disabled={submitting || !target}>
          {submitting ? <ActivityIndicator color={colors.accentText} /> : <MonoText style={styles.startLabel}>Start Routing</MonoText>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 22 },
  title: { fontSize: 15, marginBottom: 2, color: colors.white },
  subtitle: { fontSize: 11, color: colors.textMuted, marginBottom: spacing.lg },
  fieldLabel: { fontSize: 11.5, color: 'rgba(230,238,246,0.6)', marginBottom: 7 },
  segmented: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 11,
    padding: 3,
    gap: 2,
    marginBottom: spacing.md,
  },
  segment: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  segmentActive: { backgroundColor: colors.accent },
  segmentLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(230,238,246,0.6)' },
  segmentLabelActive: { color: colors.accentText },
  manualRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  manualInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: 10,
    color: colors.text,
    fontFamily: fonts.monoMedium,
    fontSize: 12.5,
  },
  prefRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  prefPill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  prefPillActive: { backgroundColor: colors.accent },
  prefLabel: { fontSize: 11.5, fontWeight: '700', color: 'rgba(230,238,246,0.7)' },
  prefLabelActive: { color: colors.accentText },
  error: { color: colors.error, fontSize: 11.5, marginBottom: spacing.sm },
  actions: { flexDirection: 'row', gap: 10 },
  cancelButton: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  cancelLabel: { color: 'rgba(230,238,246,0.8)', fontWeight: '600', fontSize: 13 },
  startButton: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 9,
    backgroundColor: colors.accent,
  },
  startLabel: { color: colors.accentText, fontWeight: '700', fontSize: 13 },
});
