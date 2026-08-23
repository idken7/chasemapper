import { create } from 'zustand';
import type { LogEvent } from '../api/types';

const MAX_LOG_ENTRIES = 500;

interface LogState {
  entries: LogEvent[];
  addEntry: (entry: LogEvent) => void;
  clear: () => void;
}

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  addEntry: (entry) =>
    set((state) => ({ entries: [entry, ...state.entries].slice(0, MAX_LOG_ENTRIES) })),
  clear: () => set({ entries: [] }),
}));
