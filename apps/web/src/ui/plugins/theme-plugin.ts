import type { UiState } from '../store/state';

export type ThemeColor = 'dark' | 'light';

export const themePlugin = {
  transactions: {
    setThemeColor: (state: UiState, themeColor: ThemeColor): UiState => ({
      ...state,
      resources: { ...state.resources, themeColor },
    }),
  },
};
