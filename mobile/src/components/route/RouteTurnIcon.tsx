import Svg, { G, Line, Path } from 'react-native-svg';
import type { RouteStep } from '../../api/types';

type Props = {
  step: Pick<RouteStep, 'type' | 'modifier'>;
  size?: number;
  color: string;
};

// Ported from the mockup's route-panel turn icons (desktop screen 09 / mobile M9):
// a single up-arrow glyph rotated left/right for turns, unrotated for
// continue/depart, and a distinct flag glyph for arrive.
export function RouteTurnIcon({ step, size = 15, color }: Props) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (step.type === 'arrive') {
    return (
      <Svg {...common}>
        <Path d="M6 3v18" />
        <Path d="M6 4h11l-3 4 3 4H6" />
      </Svg>
    );
  }

  const rotation = step.modifier?.includes('left') ? -90 : step.modifier?.includes('right') ? 90 : 0;

  return (
    <Svg {...common}>
      <G transform={rotation ? `rotate(${rotation} 12 12)` : undefined}>
        <Line x1={12} y1={19} x2={12} y2={6} />
        <Path d="M7 11 L12 6 L17 11" />
      </G>
    </Svg>
  );
}
