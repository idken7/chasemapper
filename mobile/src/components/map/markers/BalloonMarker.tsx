import { Image, Text, View } from 'react-native';
import { colors, fonts } from '../../../theme/tokens';
import type { BalloonColour } from '../../../store/telemetryStore';
import { BALLOON_ASSETS, PARACHUTE_ASSETS, PAYLOAD_ASSETS, flightPhase } from './balloonAssets';

type Props = {
  label?: string;
  colour?: BalloonColour;
  altitudeM?: number;
  velV?: number;
};

// Same balloon/parachute/payload glyphs as the desktop Cesium map (see
// cesium-map.js's upsertBalloonEntity 'track' billboard) — ascending shows the full
// balloon, descending swaps to a parachute, and landed (below PARACHUTE_MIN_ALT_M)
// shrinks to the small ground payload icon. The callsign label underneath is a
// mobile-specific addition: with several balloons/APRS chasers on screen at once,
// identical unlabeled icons are hard to tell apart.
export function BalloonMarker({ label, colour = 'blue', altitudeM = 0, velV = 0 }: Props) {
  const phase = flightPhase(altitudeM, velV);
  const source =
    phase === 'landed' ? PAYLOAD_ASSETS[colour] : phase === 'descending' ? PARACHUTE_ASSETS[colour] : BALLOON_ASSETS[colour];
  const size = phase === 'landed' ? { width: 24, height: 25 } : { width: 30, height: 55 };

  return (
    <View style={{ alignItems: 'center' }}>
      <Image source={source} style={size} resizeMode="contain" />
      {label && (
        <View
          style={{
            marginTop: 1,
            backgroundColor: 'rgba(10,13,22,0.85)',
            borderRadius: 6,
            borderWidth: 1,
            borderColor: 'rgba(255,203,5,0.4)',
            paddingHorizontal: 6,
            paddingVertical: 1.5,
          }}
        >
          <Text style={{ color: colors.accent, fontFamily: fonts.mono, fontSize: 10, fontWeight: '700' }}>
            {label}
          </Text>
        </View>
      )}
    </View>
  );
}
