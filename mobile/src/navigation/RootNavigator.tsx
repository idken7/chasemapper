import { DarkTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BottomTabBar } from './BottomTabBar';
import { AprsStack, LogStack, RouteStack, SettingsStack, TrackStack } from './stacks';
import { colors } from '../theme/tokens';
import type { BottomTabParamList } from './types';

const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.borderSubtle,
    primary: colors.accent,
  },
};

const Tab = createBottomTabNavigator<BottomTabParamList>();

export function RootNavigator() {
  return (
    <NavigationContainer theme={navigationTheme}>
      <Tab.Navigator
        screenOptions={{ headerShown: false, freezeOnBlur: true }}
        tabBar={(props) => <BottomTabBar {...props} />}
      >
        <Tab.Screen name="TrackTab" component={TrackStack} />
        <Tab.Screen name="RouteTab" component={RouteStack} />
        <Tab.Screen name="AprsTab" component={AprsStack} />
        <Tab.Screen name="LogTab" component={LogStack} />
        <Tab.Screen name="SettingsTab" component={SettingsStack} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
