import {
  syncAnalytics,
  trackClient,
  stopAnalytics,
} from '../../features/analytics/client-adapter';
import { pageArea } from '../../features/analytics/events';
import type { Consent } from '../../features/analytics/consent';
import { watchConsent } from '../../features/analytics/consent-sync';
import type { Disposable } from '../edge/use-driver';
import type { BrowserTransport } from '../edge/browser-request';
import { postConsent } from './consent-request';

export type AnalyticsPage = {
  readonly consent: Consent;
  readonly userId: string | null;
  readonly needsAdoption: boolean;
  readonly keyValue: string | null;
  readonly host: string | null;
  readonly pathname: string;
};

/** Watches the stored consent for this viewer until it changes elsewhere. */
export const watchViewerConsent = (
  consent: Consent,
  userId: string | null,
  refresh: () => void,
): Disposable => ({
  dispose: watchConsent({ consent, userId }, () => {
    stopAnalytics();
    refresh();
  }),
});

/**
 * One page view's analytics: a consent still to adopt is adopted first
 * (capture stays paused, and the page refreshes once it lands); otherwise
 * capture runs with this consent and the page's area is counted.
 */
export function openAnalyticsPage(
  page: AnalyticsPage,
  send: BrowserTransport,
  refresh: () => void,
): Disposable {
  if (page.needsAdoption) {
    stopAnalytics();
    let active = true;
    void postConsent(send, 'choice=adopt')
      .then((response) => {
        if (active && response.ok) refresh();
      })
      .catch(() => {
        /* Remain paused; retry on navigation or an identity/consent change, never in a hot loop. */
      });
    return {
      dispose: () => {
        active = false;
      },
    };
  }
  syncAnalytics({
    consent: page.consent,
    userId: page.userId,
    host: page.host,
    key: page.keyValue,
  });
  const area = pageArea(page.pathname);
  if (area) trackClient({ event: 'page_viewed', properties: { area } });
  return { dispose: stopAnalytics };
}
