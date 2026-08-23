import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors, fonts } from '../theme/tokens';
import { TrackScreen } from '../screens/track/TrackScreen';
import { RouteScreen } from '../screens/route/RouteScreen';
import { AprsListScreen } from '../screens/aprs/AprsListScreen';
import { CallsignDetailScreen } from '../screens/aprs/CallsignDetailScreen';
import { LogScreen } from '../screens/log/LogScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import type {
  AprsStackParamList,
  LogStackParamList,
  RouteStackParamList,
  SettingsStackParamList,
  TrackStackParamList,
} from './types';

const screenOptions = {
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.text,
  headerTitleStyle: { fontFamily: fonts.heading },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
} as const;

const TrackNativeStack = createNativeStackNavigator<TrackStackParamList>();
export function TrackStack() {
  return (
    <TrackNativeStack.Navigator screenOptions={screenOptions}>
      <TrackNativeStack.Screen name="Track" component={TrackScreen} options={{ headerShown: false }} />
    </TrackNativeStack.Navigator>
  );
}

const RouteNativeStack = createNativeStackNavigator<RouteStackParamList>();
export function RouteStack() {
  return (
    <RouteNativeStack.Navigator screenOptions={screenOptions}>
      <RouteNativeStack.Screen name="Route" component={RouteScreen} options={{ headerShown: false }} />
    </RouteNativeStack.Navigator>
  );
}

const AprsNativeStack = createNativeStackNavigator<AprsStackParamList>();
export function AprsStack() {
  return (
    <AprsNativeStack.Navigator screenOptions={screenOptions}>
      <AprsNativeStack.Screen name="AprsList" component={AprsListScreen} options={{ headerShown: false }} />
      <AprsNativeStack.Screen
        name="CallsignDetail"
        component={CallsignDetailScreen}
        options={({ route }) => ({ title: route.params.callsign })}
      />
    </AprsNativeStack.Navigator>
  );
}

const LogNativeStack = createNativeStackNavigator<LogStackParamList>();
export function LogStack() {
  return (
    <LogNativeStack.Navigator screenOptions={screenOptions}>
      <LogNativeStack.Screen name="Log" component={LogScreen} options={{ headerShown: false }} />
    </LogNativeStack.Navigator>
  );
}

const SettingsNativeStack = createNativeStackNavigator<SettingsStackParamList>();
export function SettingsStack() {
  return (
    <SettingsNativeStack.Navigator screenOptions={screenOptions}>
      <SettingsNativeStack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false }} />
    </SettingsNativeStack.Navigator>
  );
}
