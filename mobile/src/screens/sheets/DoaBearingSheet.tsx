import { StyleSheet, View } from 'react-native';
import { DoaCompass } from '../../components/doa/DoaCompass';
import { HeadingText, MonoText } from '../../components/ui/Text';
import { useBearingStore, doaColorForIndex, getActiveBearings } from '../../store/bearingStore';
import { colors, fonts, spacing } from '../../theme/tokens';

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <MonoText style={styles.statLabel}>{label}</MonoText>
      <MonoText style={[styles.statValue, accent && { color: colors.accent }]}>{value}</MonoText>
    </View>
  );
}

// M11 — DOA panel expanded sheet.
export function DoaBearingSheet() {
  const bySource = useBearingStore((s) => s.bySource);
  const active = getActiveBearings(bySource);
  const hasSources = active.length > 0;
  const primary = hasSources ? active[0] : null;

  const compassSources = active.map((b, i) => ({
    key: b.source,
    color: doaColorForIndex(i),
    bearingDeg: b.true_bearing,
  }));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <HeadingText style={styles.title}>DOA Bearing</HeadingText>
        <MonoText style={styles.count}>
          {active.length} SOURCE{active.length === 1 ? '' : 'S'}
        </MonoText>
      </View>

      <View style={styles.compassWrap}>
        <DoaCompass sources={compassSources} size={160} />
        {!hasSources && (
          <View style={styles.emptyOverlay}>
            <MonoText style={styles.emptyTitle}>No bearings yet</MonoText>
            <MonoText style={styles.emptySub}>Waiting for signal…</MonoText>
          </View>
        )}
      </View>

      {hasSources && (
        <View style={styles.legend}>
          {active.map((b, i) => (
            <View key={b.source} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: doaColorForIndex(i) }]} />
              <MonoText style={styles.legendLabel}>
                {b.source} {Math.round(b.true_bearing)}°
              </MonoText>
            </View>
          ))}
        </View>
      )}

      <View style={styles.stats}>
        <Stat label="BRG" value={primary ? `${Math.round(primary.true_bearing)}°` : '—'} accent />
        <Stat label="CONF" value={primary ? `${primary.confidence.toFixed(0)}%` : '—'} />
        <Stat label="PWR" value={primary ? `${primary.power.toFixed(0)}dBm` : '—'} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.xl },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: { fontSize: 14 },
  count: { fontSize: 10.5, color: colors.textFaint },
  compassWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyOverlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontFamily: fonts.headingMedium, fontSize: 11.5, fontWeight: '700', color: colors.textMuted },
  emptySub: { fontSize: 9.5, color: colors.textFaint, marginTop: 3 },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendLabel: { fontSize: 9.5, color: colors.textMuted },
  stats: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  stat: {},
  statLabel: { fontSize: 9, color: colors.textMuted, letterSpacing: 0.5, marginBottom: 2 },
  statValue: { fontSize: 16, fontWeight: '600', color: colors.text },
});
