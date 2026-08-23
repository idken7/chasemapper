import { create } from 'zustand';

// Transient status for the "Share my live location" feature (see
// useDevicePositionSharing.ts). Deliberately separate from settingsStore's
// persisted `shareLocation` preference — this is a runtime result, not
// something to remember across app launches.
interface LocationShareState {
  error: string | null;
  setError: (error: string | null) => void;
}

export const useLocationShareStore = create<LocationShareState>((set) => ({
  error: null,
  setError: (error) => set({ error }),
}));
