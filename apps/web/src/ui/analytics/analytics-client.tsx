'use client';

import { useMemo } from 'react';
import { useResource } from '../edge/use-driver';
import { browserTransport } from '../edge/browser-request';

import { usePathname, useRouter } from 'next/navigation';
import type { Consent } from '../../features/analytics/consent';
import type { Capture } from '../../features/analytics/viewer-analytics';
import { openAnalyticsPage, watchViewerConsent } from './analytics-page';

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
  const viewer = useMemo(
    () => ({
      consent: { version, necessary, analytics, replay },
      userId,
    }),
    [version, necessary, analytics, replay, userId],
  );
  useResource(viewer, (watched) =>
    watchViewerConsent(watched.consent, watched.userId, () => router.refresh()),
  );
  const page = useMemo(
    () => ({ ...viewer, needsAdoption, keyValue, host, pathname }),
    [viewer, needsAdoption, keyValue, host, pathname],
  );
  useResource(page, (viewed) =>
    openAnalyticsPage(viewed, browserTransport, () => router.refresh()),
  );
  return null;
}
