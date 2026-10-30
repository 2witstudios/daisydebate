'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  syncAnalytics,
  trackClient,
  stopAnalytics,
} from '../../features/analytics/client-adapter';
import { pageArea } from '../../features/analytics/events';
import type { Consent } from '../../features/analytics/consent';
import { watchConsent } from '../../features/analytics/consent-sync';

/** Root lifecycle binding; never passes browser locations or participant content to capture. */
export function AnalyticsClient(props: {
  readonly consent: Consent;
  readonly keyValue: string | null;
  readonly host: string | null;
  readonly userId: string | null;
  readonly needsAdoption: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    return watchConsent(props, () => {
      stopAnalytics();
      router.refresh();
    });
  }, [props.consent.analytics, props.consent.replay, props.userId, router]);
  useEffect(() => {
    if (props.needsAdoption) {
      stopAnalytics();
      let active = true;
      void fetch('/api/analytics/consent', {
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
    syncAnalytics({ ...props, key: props.keyValue });
    const area = pageArea(pathname);
    if (area) trackClient({ event: 'page_viewed', properties: { area } });
    return stopAnalytics;
  }, [
    props.consent.analytics,
    props.consent.replay,
    props.keyValue,
    props.host,
    props.userId,
    pathname,
    props.needsAdoption,
    router,
  ]);
  return null;
}
