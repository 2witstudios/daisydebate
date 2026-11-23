'use client';
import { browserScheduler } from '../edge/browser-time';
import { useResource } from '../edge/use-driver';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { startRefusedPageRetries } from './refused-page-retries';

/** The server is asked again in place until this page is replaced or left. */
export function RefusedPageRetries({
  firstWaitMs,
}: {
  readonly firstWaitMs: number;
}) {
  const router = useRouter();
  const retries = useMemo(
    () => ({ firstWaitMs, router }),
    [firstWaitMs, router],
  );
  useResource(retries, (asked) => ({
    dispose: startRefusedPageRetries({
      firstWaitMs: asked.firstWaitMs,
      refresh: () => asked.router.refresh(),
      schedule: browserScheduler.after,
    }),
  }));
  return null;
}
