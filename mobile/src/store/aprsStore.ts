import { create } from 'zustand';

// Ephemeral UI state for the APRS list screen — not part of the wire contract, so it
// doesn't belong in telemetryStore/configStore.
interface AprsUiState {
  refreshingCallsigns: Record<string, boolean>;
  startRefreshing: (callsign: string) => void;
  clearRefreshing: (callsign: string) => void;
}

export const useAprsStore = create<AprsUiState>((set) => ({
  refreshingCallsigns: {},
  startRefreshing: (callsign) =>
    set((state) => ({ refreshingCallsigns: { ...state.refreshingCallsigns, [callsign]: true } })),
  clearRefreshing: (callsign) =>
    set((state) => {
      const { [callsign]: _removed, ...rest } = state.refreshingCallsigns;
      return { refreshingCallsigns: rest };
    }),
}));
