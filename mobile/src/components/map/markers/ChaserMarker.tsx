import { CarMarker } from './CarMarker';
import { colors } from '../../../theme/tokens';

type Props = {
  headingDeg?: number | null;
};

// Other connected chasers' cars — same shape as the own-car marker, distinct color
// so it's never mistaken for "you" on the map (static/js/car.js's isMyOwnCarTelemetry
// rule, ported conceptually).
export function ChaserMarker({ headingDeg }: Props) {
  return <CarMarker color={colors.chaserOther} headingDeg={headingDeg} />;
}
