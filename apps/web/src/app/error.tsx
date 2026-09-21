'use client';

import { Button } from '../ui/components/button/button';
import { prose } from './ui/prose-class';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section>
      <h1 className={prose.h1}>Something went wrong</h1>
      <p className={prose.p}>
        This failure was recorded with correlation identifier{' '}
        {error.digest ?? 'unknown'}.
      </p>
      <Button onClick={reset}>Try again</Button>
    </section>
  );
}
