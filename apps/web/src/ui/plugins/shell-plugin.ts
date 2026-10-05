import type { DockState, UiState } from '../store/state';

export const shellPlugin = {
  transactions: {
    setDock: (state: UiState, dock: DockState): UiState => ({
      ...state,
      resources: { ...state.resources, dock },
    }),
  },
};
