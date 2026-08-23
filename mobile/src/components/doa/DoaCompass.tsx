import { Fragment } from 'react';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { colors } from '../../theme/tokens';

// Ported from the "ChaseMapper Flight Deck" mockup's DOA Bearing Panel (desktop 08/08b,
// mobile M10/M11) — fixed 200x200 viewBox regardless of rendered `size`, three
// concentric rings (r=27/54/77), N/E/S/W cardinal labels, one wedge+line+dot per source.

const VIEWBOX = 200;
const CENTER = 100;
const RINGS = [27, 54, 77];
const WEDGE_HALF_WIDTH_DEG = 14; // decorative confidence cone, matches mockup's visual width

export type DoaCompassSource = {
  key: string;
  color: string;
  bearingDeg: number;
};

type Props = {
  sources: DoaCompassSource[];
  size?: number;
};

function toXY(bearingDeg: number, radius: number) {
  const rad = (bearingDeg * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.sin(rad),
    y: CENTER - radius * Math.cos(rad),
  };
}

function wedgePath(bearingDeg: number, radius: number): string {
  const p1 = toXY(bearingDeg - WEDGE_HALF_WIDTH_DEG, radius);
  const p2 = toXY(bearingDeg + WEDGE_HALF_WIDTH_DEG, radius);
  return `M${CENTER},${CENTER} L${p1.x.toFixed(1)},${p1.y.toFixed(1)} A${radius},${radius} 0 0 1 ${p2.x.toFixed(1)},${p2.y.toFixed(1)} Z`;
}

export function DoaCompass({ sources, size = 160 }: Props) {
  const isEmpty = sources.length === 0;
  const outerRing = RINGS[RINGS.length - 1];

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}>
      {RINGS.slice(0, -1).map((r) => (
        <Circle key={r} cx={CENTER} cy={CENTER} r={r} fill="none" stroke="rgba(255,255,255,0.08)" />
      ))}
      <Circle
        cx={CENTER}
        cy={CENTER}
        r={outerRing}
        fill="none"
        stroke={isEmpty ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)'}
        strokeDasharray={isEmpty ? '4 5' : undefined}
      />
      <Line x1={CENTER} y1={CENTER - outerRing} x2={CENTER} y2={CENTER + outerRing} stroke="rgba(255,255,255,0.06)" />
      <Line x1={CENTER - outerRing} y1={CENTER} x2={CENTER + outerRing} y2={CENTER} stroke="rgba(255,255,255,0.06)" />

      {sources.map((source) => {
        const tip = toXY(source.bearingDeg, outerRing);
        return (
          <Fragment key={source.key}>
            <Path d={wedgePath(source.bearingDeg, outerRing)} fill={source.color} opacity={0.18} />
            <Line x1={CENTER} y1={CENTER} x2={tip.x} y2={tip.y} stroke={source.color} strokeWidth={2} />
            <Circle cx={tip.x} cy={tip.y} r={3.5} fill={source.color} />
          </Fragment>
        );
      })}

      <SvgText x={CENTER} y={15} textAnchor="middle" fill={colors.textMuted} fontFamily="IBMPlexMono_500Medium" fontSize={9.5}>N</SvgText>
      <SvgText x={CENTER} y={192} textAnchor="middle" fill={colors.textMuted} fontFamily="IBMPlexMono_500Medium" fontSize={9.5}>S</SvgText>
      <SvgText x={188} y={103} textAnchor="middle" fill={colors.textMuted} fontFamily="IBMPlexMono_500Medium" fontSize={9.5}>E</SvgText>
      <SvgText x={12} y={103} textAnchor="middle" fill={colors.textMuted} fontFamily="IBMPlexMono_500Medium" fontSize={9.5}>W</SvgText>
    </Svg>
  );
}
