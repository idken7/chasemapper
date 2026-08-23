export type UnitSystem = 'metric' | 'imperial';

const M_TO_FT = 3.28084;
const M_TO_MI = 0.000621371;
const MPS_TO_MPH = 2.23694;
const MPS_TO_KPH = 3.6;

export function metersToDisplayAltitude(meters: number, units: UnitSystem): number {
  return units === 'imperial' ? meters * M_TO_FT : meters;
}

export function metersToDisplayDistance(meters: number, units: UnitSystem): number {
  return units === 'imperial' ? meters * M_TO_MI : meters / 1000;
}

export function speedToDisplay(metersPerSecond: number, units: UnitSystem): number {
  return units === 'imperial' ? metersPerSecond * MPS_TO_MPH : metersPerSecond * MPS_TO_KPH;
}

export function altitudeUnitLabel(units: UnitSystem): string {
  return units === 'imperial' ? 'ft' : 'm';
}

export function distanceUnitLabel(units: UnitSystem): string {
  return units === 'imperial' ? 'mi' : 'km';
}

export function speedUnitLabel(units: UnitSystem): string {
  return units === 'imperial' ? 'mph' : 'km/h';
}

const MPS_TO_FPM = 196.85;

export function verticalRateToDisplay(metersPerSecond: number, units: UnitSystem): number {
  return units === 'imperial' ? metersPerSecond * MPS_TO_FPM : metersPerSecond;
}

export function verticalRateUnitLabel(units: UnitSystem): string {
  return units === 'imperial' ? 'ft/min' : 'm/s';
}
