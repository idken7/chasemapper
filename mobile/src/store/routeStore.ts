import { create } from 'zustand';
import type { EtaState, RouteAlternative, RouteState } from '../api/types';

export type RouteStartMode = 'chaseCar' | 'myGps' | 'manual';

interface RouteStoreState {
  route: RouteState | null;
  eta: EtaState | null;
  // Populated after a client-initiated POST /api/route (Start Routing sheet) so the
  // Fastest/Shortest pills can switch locally without re-hitting the server — mirrors
  // static/js/chase_routing.js's `window.currentRouteAlternatives`. Only the server's
  // persisted "fastest" pick (in `route`/`eta` above) is visible to other chasers.
  alternatives: RouteAlternative[] | null;
  selectedLabel: 'fastest' | 'shortest';
  targetCallsign: string | null;
  // How the active route's start point was chosen — kept so useRouteAutoRefresh can
  // re-resolve the same kind of start point (car/GPS/fixed) on each periodic
  // recompute without the sheet needing to stay mounted. Null once no route is active.
  startMode: RouteStartMode | null;
  manualStart: { lat: number; lon: number } | null;

  setRouteAndEta: (route: RouteState, eta: EtaState) => void;
  setAlternatives: (
    alternatives: RouteAlternative[],
    targetCallsign: string,
    startMode: RouteStartMode,
    manualStart?: { lat: number; lon: number } | null
  ) => void;
  // Same as setAlternatives but leaves selectedLabel untouched — used by the
  // periodic auto-refresh so it doesn't stomp a user's Fastest/Shortest pick.
  updateAlternatives: (alternatives: RouteAlternative[]) => void;
  selectAlternative: (label: 'fastest' | 'shortest') => void;
  clearRoute: () => void;
}

export const useRouteStore = create<RouteStoreState>((set) => ({
  route: null,
  eta: null,
  alternatives: null,
  selectedLabel: 'fastest',
  targetCallsign: null,
  startMode: null,
  manualStart: null,

  setRouteAndEta: (route, eta) => set({ route, eta }),
  setAlternatives: (alternatives, targetCallsign, startMode, manualStart = null) =>
    set({ alternatives, selectedLabel: 'fastest', targetCallsign, startMode, manualStart }),
  updateAlternatives: (alternatives) => set({ alternatives }),
  selectAlternative: (label) => set({ selectedLabel: label }),
  clearRoute: () =>
    set({
      route: null,
      eta: null,
      alternatives: null,
      selectedLabel: 'fastest',
      targetCallsign: null,
      startMode: null,
      manualStart: null,
    }),
}));

export function selectedAlternative(state: RouteStoreState): RouteAlternative | null {
  if (!state.alternatives) return null;
  return state.alternatives.find((a) => a.label === state.selectedLabel) ?? state.alternatives[0];
}
