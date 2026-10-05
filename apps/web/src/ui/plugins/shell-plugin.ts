import type { DockState, NavState, UiState } from '../store/state';

export const shellPlugin = {
  transactions: {
    setDock: (state: UiState, dock: DockState): UiState => ({
      ...state,
      resources: { ...state.resources, dock },
    }),
    setNav: (state: UiState, nav: NavState): UiState => ({
      ...state,
      resources: { ...state.resources, nav },
    }),
  },
};
