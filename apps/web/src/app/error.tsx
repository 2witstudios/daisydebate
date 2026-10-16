'use client';

import { useEffect } from 'react';
import { Button } from '../ui/components/button/button';
import { startAutoRetry } from './ui/auto-retry';
import { prose } from './ui/prose-class';

/**
 * Catches failed renders below the root layout, including a background
 * refresh that lands in a brief outage. Production strips the error's
 * message, so every failure retries on its own; each failed retry arrives
 * as a new error and schedules the next.
 */
export default function ErrorBoundary({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(
    () =>
      startAutoRetry({
        visibility: document,
        after: (run, milliseconds) => {
          const timer = window.setTimeout(run, milliseconds);
          return () => window.clearTimeout(timer);
        },
        retry,
      }),
    [error, retry],
  );
  return (
    <main>
      <h1 className={prose.h1}>Something went wrong</h1>
      <p className={prose.p}>
        Trying again automatically. This failure was recorded with correlation
        identifier {error.digest ?? 'unknown'}.
      </p>
      <Button onClick={retry}>Try again</Button>
    </main>
  );
}
