import { formatDistance, formatDurationS, normalizeCallsign } from './format';

describe('formatDistance', () => {
  test('renders metric kilometers', () => {
    expect(formatDistance(14200, 'metric')).toBe('14.2km');
  });

  test('renders imperial miles', () => {
    expect(formatDistance(1609.34, 'imperial')).toBe('1.0mi');
  });
});

describe('formatDurationS', () => {
  test('renders seconds only under a minute', () => {
    expect(formatDurationS(42)).toBe('42s');
  });

  test('renders minutes and seconds under an hour', () => {
    expect(formatDurationS(11 * 60 + 5)).toBe('11m 5s');
  });

  test('renders hours and minutes for an hour or more', () => {
    expect(formatDurationS(3661)).toBe('1h 1m');
  });

  test('clamps negative input to zero', () => {
    expect(formatDurationS(-5)).toBe('0s');
  });
});

describe('normalizeCallsign', () => {
  test('trims and uppercases', () => {
    expect(normalizeCallsign('  n7hab-11 ')).toBe('N7HAB-11');
  });
});
