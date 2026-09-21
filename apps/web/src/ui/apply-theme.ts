import type { ThemeColor } from './plugins/theme-plugin';

/** The slice of <html> the theme sync writes to; tests pass a plain object. */
type ThemeTarget = {
  readonly dataset: Record<string, string | undefined>;
};

/**
 * Writes the theme onto the target's `data-theme`. The DOM target is a
 * parameter so this is testable without a DOM library; ThemeEffect passes
 * `document.documentElement`.
 */
export const applyTheme = (root: ThemeTarget, themeColor: ThemeColor): void => {
  root.dataset.theme = themeColor;
};
