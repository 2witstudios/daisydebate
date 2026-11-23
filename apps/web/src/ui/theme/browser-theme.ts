import { applyTheme } from './apply-theme';
import {
  createThemeController,
  createTransition,
  type ThemeController,
} from './theme-controller';
import {
  parseThemePreference,
  type ThemePreference,
} from '../../features/theme/theme-preference';
import type { Disposable } from '../edge/use-driver';

const CHANNEL_NAME = 'daisy-theme';

/**
 * This tab's theme: the controller over the page, its cookie and the other
 * tabs' announcements, held open until the provider leaves. `show` commits
 * the chosen preference to React synchronously, so a view transition
 * snapshots the switcher's new state too.
 */
export function openBrowserTheme(
  show: (preference: ThemePreference) => void,
): ThemeController & Disposable {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const controller = createThemeController({
    // What the page shows now: the server rendered it from the cookie.
    initial: parseThemePreference(document.documentElement.dataset.theme),
    apply: (chosen) => {
      applyTheme(document.documentElement, chosen);
      show(chosen);
    },
    writeCookie: (cookie) => {
      // A plain, non-secret preference cookie; the server re-validates it.
      document.cookie = cookie;
    },
    readCookies: () => document.cookie,
    announce: () => channel.postMessage(null),
    transition: createTransition({
      startViewTransition:
        'startViewTransition' in document
          ? (update) => document.startViewTransition(update)
          : undefined,
      prefersReducedMotion: () => reducedMotion.matches,
    }),
    secure: location.protocol === 'https:',
  });
  const sync = () => controller.sync();
  // A frozen or back/forward-cached tab misses announcements; it catches
  // up from the cookie when it is shown again.
  const syncWhenVisible = () => {
    if (document.visibilityState === 'visible') sync();
  };
  channel.addEventListener('message', sync);
  document.addEventListener('visibilitychange', syncWhenVisible);
  addEventListener('pageshow', sync);
  return {
    ...controller,
    dispose: () => {
      channel.close();
      document.removeEventListener('visibilitychange', syncWhenVisible);
      removeEventListener('pageshow', sync);
    },
  };
}
