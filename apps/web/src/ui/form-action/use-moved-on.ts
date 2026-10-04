'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Navigates to `next` once a form's server action has answered with it. A
 * form posted without JavaScript is moved on by a 303 instead (`moveOn`);
 * this is the hydrated page doing the same.
 */
export function useMovedOn(next: string | undefined): void {
  const router = useRouter();
  useEffect(() => {
    if (next !== undefined) router.replace(next);
  }, [next, router]);
}
