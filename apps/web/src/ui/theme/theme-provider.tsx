'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { applyTheme } from './apply-theme';
import {
  createThemeController,
  createTransition,
  type ThemeController,
} from './theme-controller';
import type { ThemePreference } from './theme-preference';

type ThemeContextValue = {
  readonly preference: ThemePreference;
  readonly selectPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const CHANNEL_NAME = 'daisy-theme';

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
  const controller = useRef<ThemeController | null>(null);

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const next = createThemeController({
      apply: (chosen) => {
        applyTheme(document, chosen);
        // Commit synchronously so the view transition snapshots the
        // switcher's new state too.
        flushSync(() => setPreference(chosen));
      },
      writeCookie: (cookie) => {
        // A plain, non-secret preference cookie; the server re-validates it.
        document.cookie = cookie;
      },
      broadcast: (chosen) => channel.postMessage(chosen),
      transition: createTransition({
        startViewTransition:
          'startViewTransition' in document
            ? (update) => document.startViewTransition(update)
            : undefined,
        prefersReducedMotion: () => reducedMotion.matches,
      }),
      secure: location.protocol === 'https:',
    });
    channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      next.receive(event.data);
    });
    controller.current = next;
    return () => {
      controller.current = null;
      channel.close();
    };
  }, []);

  const selectPreference = useCallback((chosen: ThemePreference) => {
    controller.current?.select(chosen);
  }, []);

  const value = useMemo(
    () => ({ preference, selectPreference }),
    [preference, selectPreference],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export const useThemePreference = (): ThemeContextValue => {
  const value = useContext(ThemeContext);
  if (value === null)
    throw new Error('useThemePreference must be used inside ThemeProvider');
  return value;
};
