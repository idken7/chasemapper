import { addBoundedPoint } from './boundedTrack';

// Same cases as tests/js/utils.test.js's addBoundedLatLng suite, adapted to the
// immutable-array API used by react-native-maps' Polyline `coordinates` prop.
describe('addBoundedPoint', () => {
  test('appends points normally while under the cap', () => {
    let points: number[][] = [];
    for (let i = 0; i < 10; i++) {
      points = addBoundedPoint(points, [i, i], 100, 10);
    }
    expect(points).toHaveLength(10);
    expect(points[9]).toEqual([9, 9]);
  });

  test('does not trim until maxPoints + overshoot is exceeded', () => {
    let points: number[][] = [];
    for (let i = 0; i < 15; i++) {
      points = addBoundedPoint(points, [i, i], 10, 5);
    }
    expect(points).toHaveLength(15);

    points = addBoundedPoint(points, [15, 15], 10, 5);
    expect(points).toHaveLength(10);
  });

  test('trimming keeps the most recent points and drops the oldest', () => {
    let points: number[][] = [];
    for (let i = 0; i < 8; i++) {
      points = addBoundedPoint(points, [i, i], 5, 2);
    }
    expect(points).toEqual([[3, 3], [4, 4], [5, 5], [6, 6], [7, 7]]);
  });

  test('uses sane defaults (8000 cap) when maxPoints/overshoot are omitted', () => {
    let points: number[][] = [];
    for (let i = 0; i < 100; i++) {
      points = addBoundedPoint(points, [i, i]);
    }
    expect(points).toHaveLength(100);
  });
});
