'use client';

import Link from 'next/link';
import { Button } from '../ui/components/button/button';
import { prose } from './ui/prose-class';

export default function ErrorBoundary({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main>
      <h1 className={prose.h1}>Something went wrong</h1>
      <p className={prose.p}>
        This failure was recorded with correlation identifier{' '}
        {error.digest ?? 'unknown'}.
      </p>
      <Button onClick={retry}>Try again</Button>
      <p className={prose.p}>
        <Link href="/support">Contact support</Link>
      </p>
    </main>
  );
}
