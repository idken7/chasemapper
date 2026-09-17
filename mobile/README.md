# ChaseMapper mobile

Expo/React Native client for the [chasemapper](../README.md) backend. See
`AGENTS.md` before writing code against this Expo SDK version.

## One-time setup before building

Two things need a real value from you before a build actually works for end
users - neither can be hardcoded/committed, so `app.config.js` reads them
from the environment:

### `GOOGLE_MAPS_API_KEY`

Android maps use Google Maps and need a "Maps SDK for Android" API key from
the [Google Cloud Console](https://console.cloud.google.com/google/maps-apis)
(iOS uses Apple Maps by default and needs no key).

- Local `expo run:android`: `export GOOGLE_MAPS_API_KEY=your-key-here` before running, or put it in a local `.env` your shell loads.
- EAS builds: `eas secret:create --name GOOGLE_MAPS_API_KEY --value your-key-here` (once per EAS project).

### EAS project link (for `eas build`/`eas submit`)

`eas.json` here has the standard build profiles, but actually submitting a
build needs this repo linked to an Expo account's project - run once:

```bash
npx eas init
```

This sets `extra.eas.projectId`. Nothing in this repo can do this step for
you - it needs your own Expo account.

## Location permissions

`app.config.js`'s `expo-location` plugin config covers both foreground and
background location (see `src/location/useDevicePositionSharing.ts` and
`src/location/backgroundLocationTask.ts` for the "Share my live location"
feature this backs). Background tracking additionally needs the OS-level
background permission grant, requested separately after foreground - see
that hook's comments for why.
