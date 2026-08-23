import { StyleSheet, View, type ViewProps } from 'react-native';
import { colors } from '../../theme/tokens';

export function ScreenContainer({ style, ...rest }: ViewProps) {
  return <View style={[styles.container, style]} {...rest} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
