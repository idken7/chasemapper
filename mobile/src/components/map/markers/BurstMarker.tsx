import { Image } from 'react-native';
import { BURST_ASSET } from './balloonAssets';

// Same balloon-pop.png glyph as the desktop Cesium map's burst-point billboard.
export function BurstMarker() {
  return <Image source={BURST_ASSET} style={{ width: 20, height: 20 }} resizeMode="contain" />;
}
