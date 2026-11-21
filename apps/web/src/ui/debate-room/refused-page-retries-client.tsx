'use client';
import { useBrowserEffect } from '../edge/browser-sync';
import { scheduleDelay } from '../edge/browser-time';
import { useRouter } from 'next/navigation';

import { startRefusedPageRetries } from './refused-page-retries';

/** The server is asked again in place until this page is replaced or left. */
export function RefusedPageRetries({
  firstWaitMs,
}: {
  readonly firstWaitMs: number;
}) {
  const router = useRouter();
  useBrowserEffect(
    () =>
      startRefusedPageRetries({
        firstWaitMs,
        refresh: () => router.refresh(),
        schedule: (next, waitMs) => {
          return scheduleDelay(next, waitMs);
        },
      }),
    [firstWaitMs, router],
  );
  return null;
}
