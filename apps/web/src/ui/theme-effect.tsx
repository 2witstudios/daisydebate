'use client';

import { useEffect } from 'react';
import { useUiState } from './store/store';

/**
 * Applies the store's theme to <html data-theme>. <html> ships
 * data-theme='dark' so the first paint is dark with no flash; this effect
 * keeps the attribute in sync with the theme resource.
 */
export function ThemeEffect() {
  const themeColor = useUiState((state) => state.resources.themeColor);
  useEffect(() => {
    document.documentElement.dataset.theme = themeColor;
  }, [themeColor]);
  return null;
}
