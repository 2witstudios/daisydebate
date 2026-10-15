'use client';

import { useLayoutEffect, useState } from 'react';

/**
 * The room's one narrow threshold as a media query: `--breakpoint-narrow`
 * in globals.css defines it, so the CSS hiding (`max-narrow:`) and any
 * effect observing it cannot drift apart. Without the token the documented
 * 641px default applies.
 */
export const narrowMediaQuery = (computed: {
  getPropertyValue: (name: string) => string;
}): string => {
  const px = computed.getPropertyValue('--breakpoint-narrow').trim() || '641px';
  return `(width < ${px})`;
};

/**
 * True while the viewport is below the shell's narrow breakpoint, live
 * across resizes and rotations: a crossing re-runs the effects that depend
 * on it, so a drawer hidden by the media query alone still returns focus.
 * The first value is read synchronously so a phone's first render already
 * knows, and no crossing fires on load.
 */
export const useNarrowBreakpoint = (): boolean => {
  const [narrow, setNarrow] = useState(liveBelowBreakpoint);
  useLayoutEffect(() => {
    const query = matchMedia(
      narrowMediaQuery(getComputedStyle(document.documentElement)),
    );
    const report = () => setNarrow(query.matches);
    report();
    query.addEventListener('change', report);
    return () => query.removeEventListener('change', report);
  }, []);
  return narrow;
};

const liveBelowBreakpoint = () =>
  typeof window === 'undefined'
    ? false
    : matchMedia(narrowMediaQuery(getComputedStyle(document.documentElement)))
        .matches;
