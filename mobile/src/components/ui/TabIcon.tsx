import Svg, { Circle, Line, Path } from 'react-native-svg';
import type { TabKey } from '../../navigation/types';

type Props = {
  tab: TabKey;
  color: string;
  size?: number;
};

// Glyphs ported 1:1 from the "ChaseMapper Flight Deck" mockup's taskbar icon set
// (24x24 viewBox, 1.8px stroke, round caps).
export function TabIcon({ tab, color, size = 18 }: Props) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.8,
  } as const;

  switch (tab) {
    case 'TrackTab':
      return (
        <Svg {...common} strokeLinecap="round">
          <Circle cx={12} cy={12} r={6} />
          <Line x1={12} y1={4} x2={12} y2={20} />
          <Line x1={4} y1={12} x2={20} y2={12} />
        </Svg>
      );
    case 'RouteTab':
      return (
        <Svg {...common} strokeLinecap="round" strokeLinejoin="round">
          <Circle cx={5} cy={6} r={2} />
          <Path d="M5 8v3a3 3 0 0 0 3 3h8a3 3 0 0 1 3 3v3" />
          <Circle cx={19} cy={19} r={2} />
        </Svg>
      );
    case 'AprsTab':
      return (
        <Svg {...common} strokeLinecap="round">
          <Line x1={4} y1={12} x2={20} y2={12} />
          <Line x1={7} y1={6} x2={7} y2={18} />
          <Line x1={10} y1={7.5} x2={10} y2={16.5} />
          <Line x1={13} y1={9} x2={13} y2={15} />
          <Line x1={16} y1={10} x2={16} y2={14} />
          <Line x1={4} y1={12} x2={4} y2={20} />
        </Svg>
      );
    case 'LogTab':
      return (
        <Svg {...common} strokeLinecap="round">
          <Line x1={4} y1={6} x2={20} y2={6} />
          <Line x1={4} y1={12} x2={20} y2={12} />
          <Line x1={4} y1={18} x2={14} y2={18} />
        </Svg>
      );
    case 'SettingsTab':
      return (
        <Svg {...common} strokeLinecap="round">
          <Line x1={4} y1={7} x2={20} y2={7} />
          <Circle cx={15} cy={7} r={2.3} fill="none" />
          <Line x1={4} y1={17} x2={20} y2={17} />
          <Circle cx={9} cy={17} r={2.3} fill="none" />
        </Svg>
      );
    default:
      return null;
  }
}
