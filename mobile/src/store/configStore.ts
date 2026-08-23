import { create } from 'zustand';
import type { ChasemapperConfig } from '../api/types';

interface ConfigState {
  config: ChasemapperConfig | null;
  setConfig: (config: ChasemapperConfig) => void;
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: null,
  setConfig: (config) => set({ config }),
}));
