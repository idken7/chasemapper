import { create } from 'zustand';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface ConnectionState {
  status: ConnectionStatus;
  lastError: string | null;
  reconnectAttempt: number;
  connectedChasers: number;
  setStatus: (status: ConnectionStatus, error?: string | null) => void;
  setReconnectAttempt: (attempt: number) => void;
  setConnectedChasers: (count: number) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'disconnected',
  lastError: null,
  reconnectAttempt: 0,
  connectedChasers: 0,
  setStatus: (status, error = null) => set({ status, lastError: error }),
  setReconnectAttempt: (attempt) => set({ reconnectAttempt: attempt }),
  setConnectedChasers: (count) => set({ connectedChasers: count }),
}));
