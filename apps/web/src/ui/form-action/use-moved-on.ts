'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';

/**
 * The navigation a form performs when its server action answers with a
 * destination. A form posted without JavaScript is moved on by a 303
 * instead (`moveOn`); this is the hydrated page doing the same.
 */
export type MovedOn = {
  /** Replaces to `next` at most once per mounted form. */
  readonly navigate: (next: string | undefined) => void;
};

/**
 * Pure navigate-once guard over the router's replace: the first answered
 * destination wins, refusals (no destination) leave the form movable. Own
 * answers and adopted answers share one handle, so the destination is
 * replaced exactly once whichever path sees it first.
 */
export const createMovedOnce = (replace: (path: string) => void): MovedOn => {
  let moved: string | undefined;
  return {
    navigate: (next: string | undefined) => {
      if (next === undefined || moved !== undefined) return;
      moved = next;
      replace(next);
    },
  };
};

/**
 * The form's handle: the navigation first fires at answer time, inside the
 * action's own continuation, which runs even when a live observation update
 * unmounts the form in the same commit (MSG-5.3-arch1-pr244r1). A pending
 * effect on the unmounting form would never run and the page would stay on
 * its now-unauthorized URL.
 */
export function useMovedOnce(): MovedOn {
  const router = useRouter();
  return useMemo(
    () => createMovedOnce((path) => router.replace(path)),
    [router],
  );
}

/**
 * Effect remainder for answers React adopts without the browser wrapper
 * (a form posted during hydration). Both paths share the one handle, so
 * the destination is still replaced once.
 */
export function useMovedOnRemainder(next: string | undefined, moved: MovedOn) {
  const navigate = moved.navigate;
  useEffect(() => {
    navigate(next);
  }, [next, navigate]);
}
