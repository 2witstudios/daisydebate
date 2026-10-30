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

/** Root lifecycle binding; never passes browser locations or participant content to capture. */
export function AnalyticsClient(props: {
  readonly consent: Consent;
  readonly keyValue: string | null;
  readonly host: string | null;
  readonly userId: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    const key = 'daisy-analytics-consent';
    const changed = (event: StorageEvent) => {
      if (event.key !== key) return;
      stopAnalytics();
      router.refresh();
    };
    window.addEventListener('storage', changed);
    try {
      window.localStorage.setItem(
        key,
        JSON.stringify([props.consent, props.userId]),
      );
    } catch {
      /* Storage can be unavailable in a private browsing policy. */
    }
    return () => window.removeEventListener('storage', changed);
  }, [props.consent.analytics, props.consent.replay, props.userId, router]);
  useEffect(() => {
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
  ]);
  return null;
}
