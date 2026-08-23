import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { MonoText, BodyText } from '../../components/ui/Text';
import { colors, radii, spacing } from '../../theme/tokens';
import { calculateLookAngles } from '../../utils/lookAngles';
import { formatDistance } from '../../utils/format';
import type { UnitSystem } from '../../utils/units';
import type { BalloonTrack } from '../../store/telemetryStore';
import type { GeoPoint } from '../../utils/lookAngles';

type Props = {
  callsign: string;
  track: BalloonTrack | undefined;
  referencePosition: GeoPoint | null;
  units: UnitSystem;
  isFollowed: boolean;
  isRefreshing: boolean;
  onPress: () => void;
  onFollow: () => void;
  onSettings: () => void;
  onRefresh: () => void;
  onRemove: () => void;
};

const STALE_THRESHOLD_S = 60;
const VERY_STALE_THRESHOLD_S = 240;

// M3's four dot states: the followed row is always maize; otherwise fresh/stale/
// very-stale (faded), matching desktop's getBearingLineColour-adjacent freshness
// tiers rather than mobile's earlier 3-color scheme.
function freshnessColor(telem: BalloonTrack['telem'] | undefined, isFollowed: boolean): string {
  if (isFollowed) return colors.accent;
  if (!telem) return colors.danger;
  const ageS = Date.now() / 1000 - telem.server_time;
  if (ageS <= STALE_THRESHOLD_S) return colors.trackBlue;
  if (ageS <= VERY_STALE_THRESHOLD_S) return '#d0d4dc';
  return colors.danger;
}

function agoLabel(telem: BalloonTrack['telem'] | undefined): string {
  if (!telem) return '—';
  const ageS = Math.round(Date.now() / 1000 - telem.server_time);
  if (ageS < 60) return `${ageS}s`;
  if (ageS < 3600) return `${Math.round(ageS / 60)}m`;
  return `${Math.round(ageS / 3600)}h`;
}

export function AprsRow({
  callsign,
  track,
  referencePosition,
  units,
  isFollowed,
  isRefreshing,
  onPress,
  onFollow,
}: Props) {
  // Freshness/ago are derived from `Date.now()` at render time, so without a tick
  // they'd only refresh when the store itself changes (e.g. this callsign's own next
  // packet) and would otherwise sit frozen on-screen even as the real elapsed time
  // keeps growing.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const telem = track?.telem;
  const lookAngles =
    telem && referencePosition
      ? calculateLookAngles(referencePosition, { lat: telem.position[0], lon: telem.position[1], alt: telem.position[2] })
      : null;

  if (!isFollowed) {
    return (
      <View style={styles.plainRow}>
        <TouchableOpacity style={styles.plainRowMain} onPress={onPress} activeOpacity={0.7}>
          <View style={[styles.dot, { backgroundColor: freshnessColor(telem, false) }]} />
          <BodyText style={styles.plainCallsign}>{callsign}</BodyText>
          <MonoText style={styles.plainAgo}>{isRefreshing ? '…' : agoLabel(telem)}</MonoText>
        </TouchableOpacity>
        <TouchableOpacity style={styles.followButton} onPress={onFollow} hitSlop={8}>
          <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={colors.text} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M5 12h14M13 6l6 6-6 6" />
          </Svg>
        </TouchableOpacity>
      </View>
    );
  }

  const detailBits = [
    isRefreshing ? 'refreshing…' : `${agoLabel(telem)} ago`,
    telem ? `alt ${telem.position[2].toFixed(0)}m` : null,
    lookAngles ? `${formatDistance(lookAngles.range, units)} away` : null,
  ].filter(Boolean);

  return (
    <TouchableOpacity style={styles.followedRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.followedHeader}>
        <View style={styles.followedHeaderLeft}>
          <View style={[styles.dot, { backgroundColor: colors.accent }]} />
          <BodyText style={styles.followedCallsign}>{callsign}</BodyText>
        </View>
        <View style={styles.followedIcons}>
          <TouchableOpacity style={styles.followedIconAccent} onPress={onFollow}>
            <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={colors.accentText} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M5 12h14M13 6l6 6-6 6" />
            </Svg>
          </TouchableOpacity>
          <TouchableOpacity style={styles.followedIcon} onPress={onPress}>
            <MonoText style={styles.followedIconDots}>⋮</MonoText>
          </TouchableOpacity>
        </View>
      </View>
      <MonoText style={styles.followedDetail}>{detailBits.join(' · ')}</MonoText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  plainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radii.md,
  },
  plainRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
  },
  plainCallsign: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
  },
  plainAgo: {
    fontSize: 10,
    color: colors.textFaint,
  },
  followButton: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  followedRow: {
    borderRadius: radii.lg,
    backgroundColor: 'rgba(255,203,5,0.09)',
    borderWidth: 1,
    borderColor: colors.borderAccent,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  followedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  followedHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  followedCallsign: {
    fontSize: 13,
    fontWeight: '700',
  },
  followedIcons: {
    flexDirection: 'row',
    gap: 5,
  },
  followedIconAccent: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followedIcon: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  followedIconDots: {
    fontSize: 12,
    color: colors.text,
  },
  followedDetail: {
    fontSize: 10,
    color: 'rgba(230,238,246,0.45)',
  },
});
