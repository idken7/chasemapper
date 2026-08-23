import { StyleSheet } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { HeadingText, MonoText } from './Text';
import { colors, spacing } from '../../theme/tokens';

type Props = {
  title: string;
  note: string;
};

export function PlaceholderScreen({ title, note }: Props) {
  return (
    <ScreenContainer style={styles.center}>
      <HeadingText style={styles.title}>{title}</HeadingText>
      <MonoText style={styles.subtitle}>{note}</MonoText>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  title: { fontSize: 20 },
  subtitle: { fontSize: 12, color: colors.textMuted },
});
