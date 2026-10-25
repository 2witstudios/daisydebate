'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { browserDocument } from '../round-media/browser-document';
import { replaceRoute } from '../round-media/replace-route';

/**
 * Navigates to `next` once a form's server action has answered with it. A
 * form posted without JavaScript is moved on by a 303 instead (`moveOn`);
 * this is the hydrated page doing the same (`replaceRoute` loads a media
 * page as a document when this one lacks its Permissions-Policy).
 */
export function useMovedOn(next: string | undefined): void {
  const router = useRouter();
  useEffect(() => {
    if (next !== undefined) replaceRoute(router, browserDocument(), next);
  }, [next, router]);
}
