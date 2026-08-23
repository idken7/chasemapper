// Ported from static/js/utils.js `addBoundedLatLng` — immutable equivalent for a plain
// coordinate array (react-native-maps' Polyline takes a `coordinates` prop, not a
// mutable Leaflet-style polyline object), so state stores stay batch-trimmed the same
// way the web client trims long flight paths.

export function addBoundedPoint<T>(points: T[], point: T, maxPoints = 8000, overshoot?: number): T[] {
  const effectiveOvershoot = overshoot ?? Math.max(200, Math.round(maxPoints * 0.05));
  const next = [...points, point];
  if (next.length > maxPoints + effectiveOvershoot) {
    return next.slice(next.length - maxPoints);
  }
  return next;
}
