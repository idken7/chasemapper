import { useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { HeadingText, MonoText } from '../../components/ui/Text';
import { useConfigStore } from '../../store/configStore';
import { emitAprsPredictionOverrideUpdate } from '../../api/socket';
import { colors, fonts, radii, spacing } from '../../theme/tokens';

type Props = {
  callsign: string;
  onDone: () => void;
};

export function PredictionSettingsSheet({ callsign, onDone }: Props) {
  const config = useConfigStore((s) => s.config);
  const override = config?.aprs_prediction_overrides?.[callsign];

  const [burstAltitude, setBurstAltitude] = useState(
    String(override?.pred_burst ?? config?.pred_burst ?? '')
  );
  const [descentRate, setDescentRate] = useState(
    String(override?.pred_desc_rate ?? config?.pred_desc_rate ?? '')
  );

  const handleSave = () => {
    const pred_burst = Number(burstAltitude);
    const pred_desc_rate = Number(descentRate);
    emitAprsPredictionOverrideUpdate({
      callsign,
      pred_burst: Number.isFinite(pred_burst) ? pred_burst : undefined,
      pred_desc_rate: Number.isFinite(pred_desc_rate) ? pred_desc_rate : undefined,
    });
    onDone();
  };

  return (
    <View style={styles.container}>
      <HeadingText style={styles.title}>Prediction Settings</HeadingText>
      <MonoText style={styles.subtitle}>for {callsign}</MonoText>

      <MonoText style={styles.fieldLabel}>Burst Altitude (m)</MonoText>
      <TextInput
        style={styles.input}
        value={burstAltitude}
        onChangeText={setBurstAltitude}
        keyboardType="numeric"
        placeholderTextColor={colors.textFaint}
      />

      <MonoText style={styles.fieldLabel}>Descent Rate (m/s)</MonoText>
      <TextInput
        style={styles.input}
        value={descentRate}
        onChangeText={setDescentRate}
        keyboardType="numeric"
        placeholderTextColor={colors.textFaint}
      />

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelButton} onPress={onDone}>
          <MonoText style={styles.cancelLabel}>Cancel</MonoText>
        </TouchableOpacity>
        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
          <MonoText style={styles.saveLabel}>Save Override</MonoText>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.xxl,
  },
  title: {
    fontSize: 16,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 12.5,
    color: colors.textMuted,
    marginBottom: spacing.xl,
  },
  fieldLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 11,
    color: colors.text,
    fontFamily: fonts.monoMedium,
    fontSize: 14,
    marginBottom: spacing.lg,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  cancelButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  cancelLabel: {
    color: colors.text,
    fontWeight: '600',
  },
  saveButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
  },
  saveLabel: {
    color: colors.accentText,
    fontWeight: '700',
  },
});
