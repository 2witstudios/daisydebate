'use client';

import { usePathname } from 'next/navigation';
import type {
  AnalyticsAvailability,
  Consent,
} from '../../features/analytics/consent';
import { ConsentControls } from './consent-controls';

export function ConsentBanner(props: {
  readonly consent: Consent;
  readonly available: AnalyticsAvailability;
}) {
  const pathname = usePathname();
  if (pathname === '/analytics' || pathname === '/settings') return null;
  return <ConsentControls {...props} banner />;
}
