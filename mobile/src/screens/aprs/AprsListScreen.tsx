import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { MonoText } from '../../components/ui/Text';
import { AprsRow } from './AprsRow';
import { useConfigStore } from '../../store/configStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useAprsStore } from '../../store/aprsStore';
import { useBottomSheetStore } from '../../store/bottomSheetStore';
import { useSettingsStore } from '../../store/settingsStore';
import { emitAprsCallsignAdd, emitAprsCallsignRemove, emitAprsRefreshRequest } from '../../api/socket';
import { normalizeCallsign } from '../../utils/format';
import { colors, fonts, radii, spacing } from '../../theme/tokens';
import type { AprsStackParamList } from '../../navigation/types';
import type { GeoPoint } from '../../utils/lookAngles';

// Stable module-level fallback — a fresh `[]` inline in a Zustand selector breaks
// useSyncExternalStore's snapshot-stability check and causes an infinite render loop.
const EMPTY_CALLSIGNS: string[] = [];

export function AprsListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AprsStackParamList>>();
  const [callsignInput, setCallsignInput] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);

  const callsigns = useConfigStore((s) => s.config?.aprs_callsigns ?? EMPTY_CALLSIGNS);
  const defaultLat = useConfigStore((s) => (s.config?.default_lat as number | undefined) ?? null);
  const defaultLon = useConfigStore((s) => (s.config?.default_lon as number | undefined) ?? null);
  const balloons = useTelemetryStore((s) => s.balloons);
  const followedCallsign = useTelemetryStore((s) => s.followedCallsign);
  const setFollowedCallsign = useTelemetryStore((s) => s.setFollowedCallsign);
  const ownCar = useTelemetryStore((s) => s.ownCar);
  const primaryCar = useTelemetryStore((s) => s.primaryCar);
  const refreshingCallsigns = useAprsStore((s) => s.refreshingCallsigns);
  const startRefreshing = useAprsStore((s) => s.startRefreshing);
  const openPredictionSettings = useBottomSheetStore((s) => s.openPredictionSettings);
  const units = useSettingsStore((s) => s.units);

  const referencePosition = useMemo<GeoPoint | null>(() => {
    if (ownCar) return { lat: ownCar.position[0], lon: ownCar.position[1], alt: ownCar.position[2] };
    if (primaryCar?.lat != null && primaryCar?.lon != null) {
      return { lat: primaryCar.lat, lon: primaryCar.lon, alt: primaryCar.alt ?? 0 };
    }
    if (defaultLat != null && defaultLon != null) return { lat: defaultLat, lon: defaultLon, alt: 0 };
    return null;
  }, [ownCar, primaryCar, defaultLat, defaultLon]);

  const handleAdd = () => {
    const callsign = normalizeCallsign(callsignInput);
    if (!callsign) return;
    emitAprsCallsignAdd(callsign);
    setCallsignInput('');
    setShowAddInput(false);
  };

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <MonoText style={styles.headerTitle}>APRS Chasers</MonoText>
        <TouchableOpacity style={styles.addButton} onPress={() => setShowAddInput((v) => !v)}>
          <MonoText style={styles.addButtonLabel}>+</MonoText>
        </TouchableOpacity>
      </View>
      {showAddInput && (
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            value={callsignInput}
            onChangeText={setCallsignInput}
            placeholder="CALLSIGN-SSID"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            onSubmitEditing={handleAdd}
            returnKeyType="done"
            autoFocus
          />
          <TouchableOpacity style={styles.addConfirmButton} onPress={handleAdd}>
            <MonoText style={styles.addButtonLabel}>+</MonoText>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={callsigns}
        keyExtractor={(callsign) => callsign}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<MonoText style={styles.empty}>No callsigns tracked yet</MonoText>}
        renderItem={({ item: callsign }) => (
          <AprsRow
            callsign={callsign}
            track={balloons[callsign]}
            referencePosition={referencePosition}
            units={units}
            isFollowed={followedCallsign === callsign}
            isRefreshing={!!refreshingCallsigns[callsign]}
            onPress={() => navigation.navigate('CallsignDetail', { callsign })}
            onFollow={() => setFollowedCallsign(followedCallsign === callsign ? null : callsign)}
            onSettings={() => openPredictionSettings(callsign)}
            onRefresh={() => {
              startRefreshing(callsign);
              emitAprsRefreshRequest(callsign);
            }}
            onRemove={() => emitAprsCallsignRemove(callsign)}
          />
        )}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: fonts.heading,
    color: colors.white,
  },
  addRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 11,
    color: colors.text,
    fontFamily: fonts.monoMedium,
    fontSize: 13,
  },
  addButton: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addConfirmButton: {
    width: 44,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonLabel: {
    color: colors.accentText,
    fontSize: 18,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: spacing.xxl,
  },
});
