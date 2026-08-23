import { StyleSheet, View } from 'react-native';
import { Card } from '../../components/ui/Card';
import { HeadingText, MonoText } from '../../components/ui/Text';
import { colors, radii, spacing } from '../../theme/tokens';
import { formatDistance, formatDurationS } from '../../utils/format';
import type { UnitSystem } from '../../utils/units';
import type { PayloadTelem } from '../../api/types';

type Props = {
  telem: PayloadTelem;
  distanceM: number | null;
  timeToLandingS: number | null;
  units: UnitSystem;
};

function flightStatus(telem: PayloadTelem): string {
  if (telem.time_to_landing === 'LANDED') return 'landed';
  return telem.vel_v < 0 ? 'descending' : 'ascending';
}

export function TrackFollowedCard({ telem, distanceM, timeToLandingS, units }: Props) {
  return (
    <Card style={styles.card}>
      <HeadingText style={styles.title}>
        {telem.callsign} · {flightStatus(telem)}
      </HeadingText>
      <View style={styles.row}>
        <View>
          <MonoText style={styles.label}>DIST</MonoText>
          <HeadingText style={styles.value}>
            {distanceM !== null ? formatDistance(distanceM, units) : '—'}
          </HeadingText>
        </View>
        <View style={styles.right}>
          <MonoText style={styles.label}>ETA</MonoText>
          <HeadingText style={[styles.value, { color: colors.telemetryBlue }]}>
            {timeToLandingS !== null ? formatDurationS(timeToLandingS) : '—'}
          </HeadingText>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(18,23,40,0.92)',
    borderColor: colors.borderAccent,
    borderRadius: radii.xl,
  },
  title: {
    fontSize: 14,
    marginBottom: spacing.md,
    color: colors.accent,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  right: {
    alignItems: 'flex-end',
  },
  label: {
    fontSize: 10,
    color: 'rgba(230,238,246,0.45)',
    letterSpacing: 1,
    marginBottom: 2,
  },
  value: {
    fontSize: 23,
  },
});
