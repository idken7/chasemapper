import { StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line } from 'react-native-svg';
import { MonoText } from '../ui/Text';
import { useBearingStore, getActiveBearings } from '../../store/bearingStore';
import { useBottomSheetStore } from '../../store/bottomSheetStore';
import { colors, radii } from '../../theme/tokens';

// M10 — DOA panel collapsed pill, floating on the Track map. Always rendered (even
// with zero active sources) since it's the only entry point to the DOA sheet (M11),
// which already has its own "no bearings yet" empty state — hiding the pill would
// make that panel unreachable whenever no source has reported recently.
export function DoaCollapsedBadge() {
  const insets = useSafeAreaInsets();
  const bySource = useBearingStore((s) => s.bySource);
  const openDoaBearing = useBottomSheetStore((s) => s.openDoaBearing);
  const active = getActiveBearings(bySource);

  return (
    <TouchableOpacity style={[styles.badge, { top: insets.top + 56 }]} onPress={openDoaBearing}>
      <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth={1.8} strokeLinecap="round">
        <Circle cx={12} cy={12} r={7} />
        <Line x1={12} y1={2} x2={12} y2={6} />
      </Svg>
      <MonoText style={styles.label}>DOA · {active.length}</MonoText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: {
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
  label: {
    fontSize: 10.5,
    fontWeight: '600',
    color: colors.text,
  },
});
