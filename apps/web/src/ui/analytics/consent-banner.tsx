'use client';

import { usePathname } from 'next/navigation';
import type {
  AnalyticsAvailability,
  Consent,
} from '../../features/analytics/consent';
import { ConsentForm } from './consent-controls';

/**
 * Where the banner never shows: the pages that already hold the full
 * controls, and the Egress stage, whose headless browser never answers it and
 * would otherwise burn it into every round recording.
 */
export const bannerSuppressedOn = (pathname: string): boolean =>
  pathname === '/analytics' ||
  pathname === '/settings' ||
  pathname === '/stage' ||
  pathname.startsWith('/stage/');

export function ConsentBanner(props: {
  readonly consent: Consent;
  readonly available: AnalyticsAvailability;
}) {
  const pathname = usePathname();
  if (bannerSuppressedOn(pathname)) return null;
  return <ConsentForm {...props} banner />;
}
