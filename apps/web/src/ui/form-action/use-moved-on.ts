'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { browserDocument } from '../round-media/browser-document';
import { replaceRoute } from '../round-media/replace-route';

type RouteReplacer = Parameters<typeof replaceRoute>[0];

/** Follows a form answer's destination; `replaceRoute` picks router or document. */
export const followAnswer = (router: RouteReplacer, next: string): void =>
  replaceRoute(router, browserDocument(), next);

/**
 * Navigates to `next` once a form's server action has answered with it. A
 * form posted without JavaScript is moved on by a 303 instead (`moveOn`);
 * this is the hydrated page doing the same (`replaceRoute` loads a media
 * page as a document when this one lacks its Permissions-Policy).
 */
export function useMovedOn(
  next: string | undefined,
  beforeNavigate?: () => void,
): void {
  const router = useRouter();
  const before = useRef(beforeNavigate);
  useEffect(() => {
    before.current = beforeNavigate;
  }, [beforeNavigate]);
  useEffect(() => {
    if (next !== undefined) {
      before.current?.();
      followAnswer(router, next);
    }
  }, [next, router]);
}
