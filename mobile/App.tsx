import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableFreeze } from 'react-native-screens';
import { RootNavigator } from './src/navigation/RootNavigator';
import { BottomSheetHost } from './src/components/sheets/BottomSheetHost';
import { useAppFonts } from './src/theme/fonts';
import { colors } from './src/theme/tokens';
import { useSettingsStore } from './src/store/settingsStore';
import { useChaseMapperSocket } from './src/api/socket';
import { useRouteAutoRefresh } from './src/api/useRouteAutoRefresh';
import { useDevicePositionSharing } from './src/location/useDevicePositionSharing';
import { useRequestLocationPermission } from './src/location/useRequestLocationPermission';

SplashScreen.preventAutoHideAsync();

// Backgrounded tabs (Track/Route in particular, each holding a live MapView plus
// a 2s mobile_state poll) otherwise keep rendering and polling indefinitely once
// visited — this pauses that work while a tab isn't focused. Paired with
// `freezeOnBlur` on the tab navigator (see RootNavigator.tsx).
enableFreeze(true);

export default function App() {
  const [fontsLoaded, fontError] = useAppFonts();
  const isHydrated = useSettingsStore((s) => s.isHydrated);

  useEffect(() => {
    useSettingsStore.getState().hydrate();
  }, []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && isHydrated) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, isHydrated]);

  useChaseMapperSocket();
  useDevicePositionSharing();
  useRouteAutoRefresh();
  useRequestLocationPermission();

  if (!isHydrated || (!fontsLoaded && !fontError)) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <RootNavigator />
        <BottomSheetHost />
        <StatusBar style="light" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
