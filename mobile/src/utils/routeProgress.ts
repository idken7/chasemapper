// Nearest-vertex route-progress tracking: given the chase car's current position and
// the route's polyline, figures out which turn-by-turn steps have already been
// passed. OSRM route geometries are dense enough (a vertex roughly every few tens of
// meters on real roads) that snapping to the nearest vertex, rather than projecting
// onto the nearest segment, is accurate enough for "has this turn already happened"
// at the scale steps are spaced apart (typically hundreds of meters to km).

export interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_M = 6371000;
const DEG_TO_RAD = Math.PI / 180;

export function haversineDistanceM(a: LatLng, b: LatLng): number {
  const lat1 = a.latitude * DEG_TO_RAD;
  const lat2 = b.latitude * DEG_TO_RAD;
  const dLat = (b.latitude - a.latitude) * DEG_TO_RAD;
  const dLon = (b.longitude - a.longitude) * DEG_TO_RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Cumulative distance (meters) from the start of the polyline to each vertex.
export function cumulativeDistances(coords: LatLng[]): number[] {
  const out: number[] = coords.length ? [0] : [];
  for (let i = 1; i < coords.length; i++) {
    out.push(out[i - 1] + haversineDistanceM(coords[i - 1], coords[i]));
  }
  return out;
}

// Distance-along-route of the polyline vertex nearest to `point`.
export function distanceAlongRoute(point: LatLng, coords: LatLng[], cumulative: number[]): number | null {
  if (coords.length === 0) return null;
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversineDistanceM(point, coords[i]);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }
  return cumulative[bestIndex] ?? null;
}
