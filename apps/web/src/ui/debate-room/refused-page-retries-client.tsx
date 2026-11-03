'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { startRefusedPageRetries } from './refused-page-retries';

/** The server is asked again in place until this page is replaced or left. */
export function RefusedPageRetries({
  firstWaitMs,
}: {
  readonly firstWaitMs: number;
}) {
  const router = useRouter();
  useEffect(
    () =>
      startRefusedPageRetries({
        firstWaitMs,
        refresh: () => router.refresh(),
        schedule: (next, waitMs) => {
          const timer = window.setTimeout(next, waitMs);
          return () => window.clearTimeout(timer);
        },
      }),
    [firstWaitMs, router],
  );
  return null;
}
