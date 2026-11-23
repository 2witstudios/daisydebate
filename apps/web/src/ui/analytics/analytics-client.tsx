'use client';

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
  const consent: Consent = { version, necessary, analytics, replay };
  const viewer = JSON.stringify([
    version,
    necessary,
    analytics,
    replay,
    userId,
  ]);
  useResource(viewer, () =>
    watchViewerConsent(consent, userId, () => router.refresh()),
  );
  const page = JSON.stringify([
    viewer,
    keyValue,
    host,
    pathname,
    needsAdoption,
  ]);
  useResource(page, () =>
    openAnalyticsPage(
      { consent, userId, needsAdoption, keyValue, host, pathname },
      browserTransport,
      () => router.refresh(),
    ),
  );
  return null;
}
