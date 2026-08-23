import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../../../theme/tokens';

type Props = {
  color?: string;
  headingDeg?: number | null;
};

export function CarMarker({ color = colors.trackBlue, headingDeg }: Props) {
  const showHeading = typeof headingDeg === 'number' && Number.isFinite(headingDeg);

  return (
    <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
      {showHeading && (
        <View style={{ position: 'absolute', transform: [{ rotate: `${headingDeg}deg` }] }}>
          <Svg width={24} height={24} viewBox="0 0 24 24">
            <Path d="M12 2 L17 14 L12 11 L7 14 Z" fill={color} opacity={0.55} />
          </Svg>
        </View>
      )}
      <View
        style={{
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: color,
          borderWidth: 2,
          borderColor: colors.bg,
        }}
      />
    </View>
  );
}
