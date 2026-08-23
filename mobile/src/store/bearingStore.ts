import { create } from 'zustand';
import { colors } from '../theme/tokens';
import type { Bearing } from '../api/types';

// How long a source's latest bearing stays "active" before it's treated as stale and
// dropped from the panel — mirrors the desktop web app's `doa_panel_stale_after_s`
// (static/js/bearings.js `getActiveDoaSources`).
export const DOA_STALE_AFTER_S = 120;

interface BearingState {
  bySource: Record<string, Bearing>;
  upsert: (bearing: Bearing) => void;
  remove: (keys: string[]) => void;
}

export const useBearingStore = create<BearingState>((set) => ({
  bySource: {},
  upsert: (bearing) =>
    set((state) => ({ bySource: { ...state.bySource, [bearing.source]: bearing } })),
  remove: (keys) =>
    set((state) => {
      const next = { ...state.bySource };
      for (const key of keys) delete next[key];
      return { bySource: next };
    }),
}));

export function getActiveBearings(bySource: Record<string, Bearing>, nowS: number = Date.now() / 1000): Bearing[] {
  return Object.values(bySource)
    .filter((b) => nowS - b.timestamp <= DOA_STALE_AFTER_S)
    .sort((a, b) => b.timestamp - a.timestamp);
}

// Deterministic per-slot palette (maize first, blue second — matches the mockup's two
// example sources exactly) rather than the desktop's user-configurable bearing color,
// which mobile doesn't model.
const DOA_COLOR_PALETTE = [colors.accent, colors.trackBlue, colors.chaserOther, colors.landing, colors.warn];

export function doaColorForIndex(index: number): string {
  return DOA_COLOR_PALETTE[index % DOA_COLOR_PALETTE.length];
}
