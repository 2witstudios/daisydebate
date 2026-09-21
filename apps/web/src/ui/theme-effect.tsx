'use client';

import { useEffect } from 'react';
import { applyTheme } from './apply-theme';
import { useUiState } from './store/store';

/**
 * Applies the store's theme to <html data-theme>. <html> ships
 * data-theme='dark' so the first paint is dark with no flash; this effect
 * keeps the attribute in sync with the theme resource. The write itself
 * lives in apply-theme.ts, where it is unit tested against a fake target.
 */
export function ThemeEffect() {
  const themeColor = useUiState((state) => state.resources.themeColor);
  useEffect(() => {
    applyTheme(document.documentElement, themeColor);
  }, [themeColor]);
  return null;
}
