// The module registers its task with TaskManager at import time.
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-location', () => ({ Accuracy: { High: 4 } }));
jest.mock('expo-secure-store', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));

import { isTransientLocationError, shouldPostBackgroundPosition } from './backgroundLocationTask';
import { DEVICE_POSITION_BACKGROUND_INTERVAL_MS } from '../api/constants';

describe('shouldPostBackgroundPosition', () => {
  const now = 1_000_000;

  test('never posts while the live socket is connected (it is already sending)', () => {
    expect(shouldPostBackgroundPosition('connected', now, 0)).toBe(false);
  });

  test('posts when the socket is down and no recent post was made', () => {
    for (const status of ['disconnected', 'reconnecting', 'error', 'connecting'] as const) {
      expect(shouldPostBackgroundPosition(status, now, 0)).toBe(true);
    }
  });

  test('throttles to one post per background interval', () => {
    const last = now - DEVICE_POSITION_BACKGROUND_INTERVAL_MS + 1;
    expect(shouldPostBackgroundPosition('disconnected', now, last)).toBe(false);
    expect(shouldPostBackgroundPosition('disconnected', now + 1, last)).toBe(true);
  });
});

describe('isTransientLocationError', () => {
  test('location-unknown (kCLErrorDomain code 0) is transient', () => {
    expect(isTransientLocationError(new Error('Error Domain=kCLErrorDomain Code=0 "(null)"'))).toBe(true);
  });

  test('other Core Location errors (e.g. denied, code 1) are not', () => {
    expect(isTransientLocationError(new Error('Error Domain=kCLErrorDomain Code=1 "(null)"'))).toBe(false);
    expect(isTransientLocationError(new Error('Error Domain=kCLErrorDomain Code=10 "(null)"'))).toBe(false);
    expect(isTransientLocationError(null)).toBe(false);
  });
});
