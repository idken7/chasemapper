import { Text, type TextProps } from 'react-native';
import { colors, fonts } from '../../theme/tokens';

export function MonoText({ style, ...rest }: TextProps) {
  return <Text style={[{ fontFamily: fonts.monoMedium, color: colors.text }, style]} {...rest} />;
}

export function HeadingText({ style, ...rest }: TextProps) {
  return <Text style={[{ fontFamily: fonts.heading, color: colors.text }, style]} {...rest} />;
}

export function BodyText({ style, ...rest }: TextProps) {
  return <Text style={[{ fontFamily: fonts.headingMedium, color: colors.text }, style]} {...rest} />;
}
