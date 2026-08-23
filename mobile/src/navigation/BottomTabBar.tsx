import { StyleSheet, TouchableOpacity, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabIcon } from '../components/ui/TabIcon';
import { MonoText } from '../components/ui/Text';
import { colors, layout } from '../theme/tokens';
import type { TabKey } from './types';

const TAB_LABELS: Record<TabKey, string> = {
  TrackTab: 'Track',
  RouteTab: 'Route',
  AprsTab: 'APRS',
  LogTab: 'Log',
  SettingsTab: 'Settings',
};

export function BottomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, 8), height: layout.tabBarHeight + insets.bottom },
      ]}
    >
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const tabKey = route.name as TabKey;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        const tint = isFocused ? colors.accent : colors.text;

        return (
          <TouchableOpacity
            key={route.key}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            onPress={onPress}
            style={styles.tab}
          >
            <TabIcon tab={tabKey} color={tint} size={18} />
            <MonoText style={[styles.label, { color: tint, opacity: isFocused ? 1 : 0.4 }]}>
              {TAB_LABELS[tabKey]}
            </MonoText>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#0d1120',
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingHorizontal: 16,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  label: {
    fontSize: 8.5,
  },
});
