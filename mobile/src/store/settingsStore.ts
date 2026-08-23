import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOrCreateClientId } from '../location/clientIdentity';
import type { UnitSystem } from '../utils/units';

// API key is treated as sensitive (it gates a shared, internet-exposed server) and
// lives in SecureStore. Everything else here is a plain local preference in
// AsyncStorage. `clientId` is device identity, not a user preference — see
// location/clientIdentity.ts — but is mirrored here for convenient access.
const SERVER_URL_KEY = 'chasemapper.serverUrl';
const CHASER_NAME_KEY = 'chasemapper.chaserName';
const UNITS_KEY = 'chasemapper.units';
const API_KEY_SECURE_KEY = 'chasemapper.apiKey';
const SHARE_LOCATION_KEY = 'chasemapper.shareLocation';

interface SettingsState {
  isHydrated: boolean;
  serverUrl: string;
  apiKey: string | null;
  chaserName: string;
  units: UnitSystem;
  clientId: string | null;
  // Local device preference — mirrors the desktop web app's "Share My Live Location"
  // toggle (Settings > My Chase Car). Not synced to server config: each device
  // decides independently whether it broadcasts its own GPS as a chase car.
  shareLocation: boolean;

  hydrate: () => Promise<void>;
  setServerUrl: (url: string) => Promise<void>;
  setApiKey: (key: string | null) => Promise<void>;
  setChaserName: (name: string) => Promise<void>;
  setUnits: (units: UnitSystem) => Promise<void>;
  setShareLocation: (enabled: boolean) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isHydrated: false,
  serverUrl: '',
  apiKey: null,
  chaserName: '',
  units: 'metric',
  clientId: null,
  shareLocation: false,

  hydrate: async () => {
    const [serverUrl, chaserName, unitsRaw, apiKey, clientId, shareLocationRaw] = await Promise.all([
      AsyncStorage.getItem(SERVER_URL_KEY),
      AsyncStorage.getItem(CHASER_NAME_KEY),
      AsyncStorage.getItem(UNITS_KEY),
      SecureStore.getItemAsync(API_KEY_SECURE_KEY),
      getOrCreateClientId(),
      AsyncStorage.getItem(SHARE_LOCATION_KEY),
    ]);
    set({
      serverUrl: serverUrl ?? '',
      chaserName: chaserName ?? '',
      units: unitsRaw === 'imperial' ? 'imperial' : 'metric',
      apiKey,
      clientId,
      shareLocation: shareLocationRaw === '1',
      isHydrated: true,
    });
  },

  setServerUrl: async (url) => {
    await AsyncStorage.setItem(SERVER_URL_KEY, url);
    set({ serverUrl: url });
  },

  setApiKey: async (key) => {
    if (key) {
      await SecureStore.setItemAsync(API_KEY_SECURE_KEY, key);
    } else {
      await SecureStore.deleteItemAsync(API_KEY_SECURE_KEY);
    }
    set({ apiKey: key });
  },

  setChaserName: async (name) => {
    await AsyncStorage.setItem(CHASER_NAME_KEY, name);
    set({ chaserName: name });
  },

  setUnits: async (units) => {
    await AsyncStorage.setItem(UNITS_KEY, units);
    set({ units });
  },

  setShareLocation: async (enabled) => {
    await AsyncStorage.setItem(SHARE_LOCATION_KEY, enabled ? '1' : '0');
    set({ shareLocation: enabled });
  },
}));
