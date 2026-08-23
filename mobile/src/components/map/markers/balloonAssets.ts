import type { BalloonColour } from '../../../store/telemetryStore';

// Same PNGs the desktop Cesium map uses (static/img/*.png) — copied into
// assets/balloon/ so the two clients render identical balloon/parachute/payload/
// landing-target glyphs instead of the mobile app's plain colored dots.
export const BALLOON_ASSETS: Record<BalloonColour, number> = {
  blue: require('../../../../assets/balloon/balloon-blue.png'),
  green: require('../../../../assets/balloon/balloon-green.png'),
  purple: require('../../../../assets/balloon/balloon-purple.png'),
};

export const PARACHUTE_ASSETS: Record<BalloonColour, number> = {
  blue: require('../../../../assets/balloon/parachute-blue.png'),
  green: require('../../../../assets/balloon/parachute-green.png'),
  purple: require('../../../../assets/balloon/parachute-purple.png'),
};

export const PAYLOAD_ASSETS: Record<BalloonColour, number> = {
  blue: require('../../../../assets/balloon/payload-blue.png'),
  green: require('../../../../assets/balloon/payload-green.png'),
  purple: require('../../../../assets/balloon/payload-purple.png'),
};

export const TARGET_ASSETS: Record<BalloonColour, number> = {
  blue: require('../../../../assets/balloon/target-blue.png'),
  green: require('../../../../assets/balloon/target-green.png'),
  purple: require('../../../../assets/balloon/target-purple.png'),
};

export const BURST_ASSET: number = require('../../../../assets/balloon/balloon-pop.png');

// Matches static/js/settings.js's parachute_min_alt — below this the payload is
// treated as landed and shown with the small ground-icon rather than a parachute.
export const PARACHUTE_MIN_ALT_M = 300;

export type FlightPhase = 'ascending' | 'descending' | 'landed';

export function flightPhase(altitudeM: number, velV: number): FlightPhase {
  if (altitudeM < PARACHUTE_MIN_ALT_M) return 'landed';
  return velV < 0 ? 'descending' : 'ascending';
}
