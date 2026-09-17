// Dynamic config (instead of app.json) so the Google Maps API key never has
// to be committed in plaintext - it's read from an env var here and supplied
// at build time (a local .env/shell var for `expo run:android`, an EAS Build
// secret for store builds). See mobile/README.md for how to obtain and set
// GOOGLE_MAPS_API_KEY. Everything else is the same static config app.json
// used to hold.
module.exports = {
  expo: {
    name: 'ChaseMapper',
    slug: 'chasemapper-mobile',
    scheme: 'chasemapper',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    backgroundColor: '#0a0d16',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'edu.umich.chasemapper',
      buildNumber: '1',
      infoPlist: {
        // Exempts local-network (RFC1918/.local) addresses from ATS so the
        // app can reach a self-hosted chasemapper backend over plain HTTP on
        // a LAN, without disabling ATS for arbitrary internet hosts. Doesn't
        // help if the backend is a non-TLS *public* host - out of scope here,
        // see README.md's reverse-proxy docs for that case.
        NSAppTransportSecurity: {
          NSAllowsLocalNetworking: true,
        },
        // Keeps location updates (and the socket reconnect they trigger)
        // flowing while backgrounded - see src/location/backgroundLocationTask.ts.
        UIBackgroundModes: ['location'],
      },
    },
    android: {
      package: 'edu.umich.chasemapper',
      versionCode: 1,
      adaptiveIcon: {
        backgroundColor: '#0a0d16',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      // Android 9+ (API 28+) blocks cleartext HTTP by default, same reason as
      // iOS's ATS above - same self-hosted-LAN-backend justification.
      usesCleartextTraffic: true,
      config: {
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_API_KEY,
        },
      },
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-font',
      'expo-splash-screen',
      'expo-secure-store',
      'react-native-maps',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'ChaseMapper uses your location to show your position on the chase map and share it with your chase team.',
          locationAlwaysAndWhenInUsePermission:
            'ChaseMapper uses your location to keep sharing your position with your chase team while the app is in the background, e.g. while using a separate navigation app.',
          isIOSBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true,
        },
      ],
    ],
  },
};
