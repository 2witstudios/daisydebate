import {
  isThemePreference,
  serializeThemeCookie,
  type ThemePreference,
} from './theme-preference';

type Update = () => void;

export type ThemeControllerDeps = {
  /** Writes the preference onto the page (DOM and React state). */
  readonly apply: (preference: ThemePreference) => void;
  readonly writeCookie: (cookie: string) => void;
  /** Tells the viewer's other tabs about the new preference. */
  readonly broadcast: (preference: ThemePreference) => void;
  readonly transition: (update: Update) => void;
  readonly secure: boolean;
};

export type ThemeController = {
  readonly select: (preference: ThemePreference) => void;
  /** Applies an untrusted cross-tab message; returns what it applied. */
  readonly receive: (message: unknown) => ThemePreference | undefined;
};

/**
 * Orders a theme switch's side effects; the provider injects the real ones
 * (effect extraction, docs/development/testing.md).
 */
export const createThemeController = ({
  apply,
  writeCookie,
  broadcast,
  transition,
  secure,
}: ThemeControllerDeps): ThemeController => ({
  select: (preference) => {
    writeCookie(serializeThemeCookie(preference, { secure }));
    transition(() => apply(preference));
    broadcast(preference);
  },
  receive: (message) => {
    if (!isThemePreference(message)) return undefined;
    transition(() => apply(message));
    return message;
  },
});

/** Crossfades a switch with a view transition unless motion is reduced. */
export const createTransition =
  ({
    startViewTransition,
    prefersReducedMotion,
  }: {
    readonly startViewTransition: ((update: Update) => unknown) | undefined;
    readonly prefersReducedMotion: () => boolean;
  }) =>
  (update: Update): void => {
    if (startViewTransition === undefined || prefersReducedMotion()) update();
    else startViewTransition(update);
  };
