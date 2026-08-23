import { calculateLookAngles } from './lookAngles';

// Same cases as tests/js/utils.test.js so mobile and web agree on the math.
describe('calculateLookAngles', () => {
  test('elevation is ~0 for two points at the same altitude and a large horizontal separation', () => {
    const a = { lat: 0, lon: 0, alt: 0 };
    const b = { lat: 0, lon: 1, alt: 0 };
    const info = calculateLookAngles(a, b);
    expect(info.elevation).toBeCloseTo(0, 0);
    expect(info.range).toBeGreaterThan(0);
  });

  test('elevation is close to 90 degrees for a point almost directly overhead', () => {
    const a = { lat: 0, lon: 0, alt: 0 };
    const b = { lat: 0.0001, lon: 0, alt: 30000 };
    const info = calculateLookAngles(a, b);
    expect(info.elevation).toBeGreaterThan(80);
  });

  test('bearing string reflects an eastward, northern-hemisphere-style target', () => {
    const a = { lat: 0, lon: 0, alt: 0 };
    const b = { lat: 0, lon: 1, alt: 0 };
    const info = calculateLookAngles(a, b);
    expect(info.bearing).toContain('E');
  });

  test('does not mutate its inputs (unlike the original web implementation)', () => {
    const a = { lat: 10, lon: 20, alt: 100 };
    const b = { lat: 30, lon: 40, alt: 200 };
    calculateLookAngles(a, b);
    expect(a).toEqual({ lat: 10, lon: 20, alt: 100 });
    expect(b).toEqual({ lat: 30, lon: 40, alt: 200 });
  });
});
