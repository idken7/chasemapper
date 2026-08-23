import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Persisted per-install identity used on every `device_position` emit so the
// server's ownership-lease logic (CLIENT_CAR_OWNERSHIP_GRACE_S) keeps attributing
// this device's chase-car track to the same client_id across app restarts.
const CLIENT_ID_KEY = 'chasemapper.clientId';

let cached: string | null = null;

export async function getOrCreateClientId(): Promise<string> {
  if (cached) return cached;

  const stored = await AsyncStorage.getItem(CLIENT_ID_KEY);
  if (stored) {
    cached = stored;
    return stored;
  }

  const generated = Crypto.randomUUID();
  await AsyncStorage.setItem(CLIENT_ID_KEY, generated);
  cached = generated;
  return generated;
}
