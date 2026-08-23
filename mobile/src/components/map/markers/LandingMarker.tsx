import { Image } from 'react-native';
import type { BalloonColour } from '../../../store/telemetryStore';
import { TARGET_ASSETS } from './balloonAssets';

type Props = {
  colour?: BalloonColour;
};

// Same target-{colour}.png glyph as the desktop Cesium map's predicted-landing
// billboard (cesium-map.js), colour-matched to that balloon's marker/path.
export function LandingMarker({ colour = 'blue' }: Props) {
  return <Image source={TARGET_ASSETS[colour]} style={{ width: 20, height: 20 }} resizeMode="contain" />;
}
