import { create } from 'zustand';

export type SheetKind = 'predictionSettings' | 'markRecovered' | 'startRouting' | 'doaBearing' | null;

interface BottomSheetState {
  sheet: SheetKind;
  // Reused across sheets that target a single callsign (prediction settings, mark
  // recovered, start-routing's destination). Unused by doaBearing.
  callsign: string | null;
  openPredictionSettings: (callsign: string) => void;
  openMarkRecovered: (callsign: string) => void;
  openStartRouting: (targetCallsign: string) => void;
  openDoaBearing: () => void;
  close: () => void;
}

export const useBottomSheetStore = create<BottomSheetState>((set) => ({
  sheet: null,
  callsign: null,
  openPredictionSettings: (callsign) => set({ sheet: 'predictionSettings', callsign }),
  openMarkRecovered: (callsign) => set({ sheet: 'markRecovered', callsign }),
  openStartRouting: (targetCallsign) => set({ sheet: 'startRouting', callsign: targetCallsign }),
  openDoaBearing: () => set({ sheet: 'doaBearing', callsign: null }),
  close: () => set({ sheet: null, callsign: null }),
}));
