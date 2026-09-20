import type { UiState } from '../store/state';

export const shellPlugin = {
  transactions: {
    setSearchQuery: (state: UiState, searchQuery: string): UiState => ({
      ...state,
      resources: { ...state.resources, searchQuery },
    }),
    setActiveRoute: (state: UiState, activeRoute: string): UiState => ({
      ...state,
      resources: { ...state.resources, activeRoute },
    }),
  },
};
