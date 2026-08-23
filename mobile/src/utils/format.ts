import { distanceUnitLabel, metersToDisplayDistance, type UnitSystem } from './units';

export function formatDistance(meters: number, units: UnitSystem): string {
  const value = metersToDisplayDistance(meters, units);
  return `${value.toFixed(1)}${distanceUnitLabel(units)}`;
}

export function formatDurationS(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function normalizeCallsign(input: string): string {
  return input.trim().toUpperCase();
}
