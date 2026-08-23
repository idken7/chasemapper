import { useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import { HeadingText, MonoText } from '../../components/ui/Text';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useSettingsStore } from '../../store/settingsStore';
import { emitMarkRecovered } from '../../api/socket';
import { colors, fonts, radii, spacing } from '../../theme/tokens';
import type { LatLonAlt } from '../../api/types';

type Props = {
  callsign: string;
  onDone: () => void;
};

// M8 — sheet, mark recovered.
export function MarkRecoveredSheet({ callsign, onDone }: Props) {
  const track = useTelemetryStore((s) => s.balloons[callsign]);
  const chaserName = useSettingsStore((s) => s.chaserName);

  const [recovered, setRecovered] = useState(true);
  const [position, setPosition] = useState<LatLonAlt>(track?.telem.position ?? [0, 0, 0]);
  const [notes, setNotes] = useState('');
  const [locating, setLocating] = useState(false);

  const useMyPosition = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== Location.PermissionStatus.GRANTED) return;
      const loc = await Location.getCurrentPositionAsync({});
      setPosition([loc.coords.latitude, loc.coords.longitude, loc.coords.altitude ?? 0]);
    } catch {
      // Ignore — the field stays as-is (last known balloon position) if location fails.
    } finally {
      setLocating(false);
    }
  };

  const handleConfirm = () => {
    emitMarkRecovered({
      payload_call: callsign,
      my_call: chaserName || 'unknown',
      last_pos: position,
      message: notes,
      recovered,
    });
    onDone();
  };

  return (
    <View style={styles.container}>
      <HeadingText style={styles.title}>Mark {callsign} recovered</HeadingText>

      <TouchableOpacity style={styles.checkboxRow} onPress={() => setRecovered((r) => !r)}>
        <View style={[styles.checkbox, recovered && styles.checkboxChecked]}>
          {recovered && <MonoText style={styles.checkmark}>✓</MonoText>}
        </View>
        <MonoText style={styles.checkboxLabel}>Recovery successful</MonoText>
      </TouchableOpacity>

      <MonoText style={styles.fieldLabel}>Position</MonoText>
      <View style={styles.positionRow}>
        <View style={styles.positionField}>
          <MonoText style={styles.positionText}>
            {position[0].toFixed(5)}, {position[1].toFixed(5)}
          </MonoText>
        </View>
      </View>
      <TouchableOpacity style={styles.useMyPositionButton} onPress={useMyPosition} disabled={locating}>
        <MonoText style={styles.useMyPositionLabel}>{locating ? 'Locating…' : 'Use my position'}</MonoText>
      </TouchableOpacity>

      <MonoText style={styles.fieldLabel}>Notes</MonoText>
      <TextInput
        style={styles.notesInput}
        value={notes}
        onChangeText={setNotes}
        placeholder="Landed in open field, easy access from Rd 12…"
        placeholderTextColor={colors.textFaint}
        multiline
      />

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelButton} onPress={onDone}>
          <MonoText style={styles.cancelLabel}>Cancel</MonoText>
        </TouchableOpacity>
        <TouchableOpacity style={styles.confirmButton} onPress={handleConfirm}>
          <MonoText style={styles.confirmLabel}>Confirm Recovery</MonoText>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.xxl },
  title: { fontSize: 15, marginBottom: spacing.lg },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: spacing.md },
  checkbox: {
    width: 17,
    height: 17,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.accent },
  checkmark: { color: colors.accentText, fontSize: 11, fontWeight: '700' },
  checkboxLabel: { fontSize: 12.5, color: colors.text },
  fieldLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 5 },
  positionRow: { flexDirection: 'row', gap: 6, marginBottom: spacing.sm },
  positionField: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: 9,
  },
  positionText: { fontFamily: fonts.monoMedium, fontSize: 11.5, color: colors.text },
  useMyPositionButton: {
    alignItems: 'center',
    padding: 9,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginBottom: spacing.lg,
  },
  useMyPositionLabel: { fontSize: 11.5, fontWeight: '600', color: colors.text },
  notesInput: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: 11,
    minHeight: 44,
    color: colors.text,
    fontSize: 13,
    marginBottom: spacing.lg,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  cancelButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  cancelLabel: { color: colors.text, fontWeight: '600', fontSize: 13 },
  confirmButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
  },
  confirmLabel: { color: colors.accentText, fontWeight: '700', fontSize: 13 },
});
