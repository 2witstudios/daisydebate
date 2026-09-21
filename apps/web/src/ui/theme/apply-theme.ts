import { themeColorFor, type ThemePreference } from './theme-preference';

/**
 * The slice of `document` a theme switch writes to; tests pass a plain
 * object. Method syntax keeps the real DOM signatures assignable.
 */
type ThemeDocument = {
  readonly documentElement: {
    readonly dataset: Record<string, string | undefined>;
  };
  querySelectorAll(selector: string): Iterable<{
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
  }>;
};

/**
 * Applies a preference client-side: `data-theme` drives `color-scheme` (and
 * so every `light-dark()` token), and the theme-color metas get the new
 * colors so browser chrome matches. The server renders both from the cookie,
 * so this only runs on a switch. The metas belong to React (viewport
 * metadata), so their content is rewritten in place, never removed.
 */
export const applyTheme = (
  doc: ThemeDocument,
  preference: ThemePreference,
): void => {
  doc.documentElement.dataset.theme = preference;
  const colors = themeColorFor(preference);
  for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
    const entry = colors.find(
      ({ media }) => media === meta.getAttribute('media'),
    );
    if (entry !== undefined) meta.setAttribute('content', entry.color);
  }
};
