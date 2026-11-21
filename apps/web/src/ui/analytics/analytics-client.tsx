'use client';

import { useBrowserEffect } from '../edge/browser-sync';
import { browserFetch } from '../edge/browser-request';

import { usePathname, useRouter } from 'next/navigation';
import {
  syncAnalytics,
  trackClient,
  stopAnalytics,
} from '../../features/analytics/client-adapter';
import { pageArea } from '../../features/analytics/events';
import type { Consent } from '../../features/analytics/consent';
import type { Capture } from '../../features/analytics/viewer-analytics';
import { watchConsent } from '../../features/analytics/consent-sync';

/** Visitor-page lifecycle binding (ADR 0123); never passes browser locations or participant content to capture. */
export function AnalyticsClient({
  consent: { version, necessary, analytics, replay },
  userId,
  needsAdoption,
  keyValue,
  host,
}: Capture & { readonly consent: Consent }) {
  const pathname = usePathname();
  const router = useRouter();
  useBrowserEffect(() => {
    return watchConsent(
      { consent: { version, necessary, analytics, replay }, userId },
      () => {
        stopAnalytics();
        router.refresh();
      },
    );
  }, [version, necessary, analytics, replay, userId, router]);
  useBrowserEffect(() => {
    if (needsAdoption) {
      stopAnalytics();
      let active = true;
      void browserFetch('/api/analytics/consent', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'choice=adopt',
      })
        .then((response) => {
          if (active && response.ok) router.refresh();
        })
        .catch(() => {
          /* Remain paused; retry on navigation or an identity/consent change, never in a hot loop. */
        });
      return () => {
        active = false;
      };
    }
    syncAnalytics({
      consent: { version, necessary, analytics, replay },
      userId,
      host,
      key: keyValue,
    });
    const area = pageArea(pathname);
    if (area) trackClient({ event: 'page_viewed', properties: { area } });
    return stopAnalytics;
  }, [
    version,
    necessary,
    analytics,
    replay,
    keyValue,
    host,
    userId,
    pathname,
    needsAdoption,
    router,
  ]);
  return null;
}
