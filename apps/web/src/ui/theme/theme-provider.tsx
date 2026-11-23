'use client';

import { useResource } from '../edge/use-driver';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { openBrowserTheme } from './browser-theme';
import {
  colorSchemeFor,
  themeColorFor,
  type ThemePreference,
} from '../../features/theme/theme-preference';

type ThemeContextValue = {
  readonly preference: ThemePreference;
  readonly selectPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export type ThemeProviderProps = {
  /** The request's cookie preference, parsed by the root layout. */
  readonly initialPreference: ThemePreference;
  readonly children: ReactNode;
};

/**
 * Request-scoped theme state (ADR 0027): seeded from the request cookie, so
 * server HTML and the first client render agree. Switches persist to the
 * cookie, crossfade via view transitions, and sync across tabs through a
 * BroadcastChannel.
 */
export function ThemeProvider({
  initialPreference,
  children,
}: ThemeProviderProps) {
  const [preference, setPreference] = useState(initialPreference);

  // One controller for this provider's preference: it applies each choice.
  const controller = useResource(setPreference, (apply) =>
    openBrowserTheme((chosen) => flushSync(() => apply(chosen))),
  );

  const selectPreference = useCallback(
    (chosen: ThemePreference) => controller?.select(chosen),
    [controller],
  );

  const value = useMemo(
    () => ({ preference, selectPreference }),
    [preference, selectPreference],
  );

  // React 19 hoists these into <head> and owns them, so browser chrome
  // follows the preference across soft and back/forward navigations.
  return (
    <ThemeContext value={value}>
      <meta name="color-scheme" content={colorSchemeFor(preference)} />
      {themeColorFor(preference).map(({ media, color }) => (
        <meta key={media} name="theme-color" media={media} content={color} />
      ))}
      {children}
    </ThemeContext>
  );
}

export const useThemePreference = (): ThemeContextValue => {
  const value = useContext(ThemeContext);
  if (value === null)
    throw new Error('useThemePreference must be used inside ThemeProvider');
  return value;
};
