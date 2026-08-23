// Ported from static/js/utils.js `calculate_lookangles` (Daniel Richman's earthmath.py,
// via the existing web frontend) so azimuth/elevation/range agree between web and mobile.
// Verified against the same cases as tests/js/utils.test.js.

const DEG_TO_RAD = Math.PI / 180.0;
const EARTH_RADIUS_M = 6371000.0;

export interface GeoPoint {
  lat: number;
  lon: number;
  alt: number;
}

export interface LookAngles {
  elevation: number; // degrees
  azimuth: number; // degrees, 0-360 true
  range: number; // meters (slant range, accounts for altitude difference)
  bearing: string; // e.g. "N 45° E"
}

export function calculateLookAngles(from: GeoPoint, to: GeoPoint): LookAngles {
  const aLat = from.lat * DEG_TO_RAD;
  const aLon = from.lon * DEG_TO_RAD;
  const bLat = to.lat * DEG_TO_RAD;
  const bLon = to.lon * DEG_TO_RAD;

  const dLon = bLon - aLon;
  const sa = Math.cos(bLat) * Math.sin(dLon);
  const sb = Math.cos(aLat) * Math.sin(bLat) - Math.sin(aLat) * Math.cos(bLat) * Math.cos(dLon);
  let bearing = Math.atan2(sa, sb);
  const aa = Math.sqrt(sa * sa + sb * sb);
  const ab = Math.sin(aLat) * Math.sin(bLat) + Math.cos(aLat) * Math.cos(bLat) * Math.cos(dLon);
  const angleAtCentre = Math.atan2(aa, ab);

  const ta = EARTH_RADIUS_M + from.alt;
  const tb = EARTH_RADIUS_M + to.alt;
  const ea = Math.cos(angleAtCentre) * tb - ta;
  const eb = Math.sin(angleAtCentre) * tb;
  const elevation = Math.atan2(ea, eb) / DEG_TO_RAD;

  // Law of cosines for the unknown side (slant range).
  const range = Math.sqrt(ta * ta + tb * tb - 2 * tb * ta * Math.cos(angleAtCentre));

  bearing += bearing < 0 ? 2 * Math.PI : 0;
  bearing /= DEG_TO_RAD;

  let value = Math.round(bearing % 90);
  value = (bearing > 90 && bearing < 180) || (bearing > 270 && bearing < 360) ? 90 - value : value;
  const bearingLabel = `${bearing < 90 || bearing > 270 ? 'N' : 'S'} ${value}° ${bearing < 180 ? 'E' : 'W'}`;

  return { elevation, azimuth: bearing, range, bearing: bearingLabel };
}
