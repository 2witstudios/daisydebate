'use client';

import { useLayoutEffect, useState } from 'react';

/**
 * The room's one phone-layout threshold as a media query: `--breakpoint-compact`
 * in globals.css defines it, so the CSS hiding (`max-compact:`) and any
 * effect observing it cannot drift apart. Without the token the documented
 * 901px default applies.
 */
export const phoneMediaQuery = (computed: {
  getPropertyValue: (name: string) => string;
}): string => {
  const px =
    computed.getPropertyValue('--breakpoint-compact').trim() || '901px';
  return `(width < ${px})`;
};

/**
 * True while the viewport is below the room's phone layout, live
 * across resizes and rotations: a crossing re-runs the effects that depend
 * on it, so a region hidden by the media query alone still returns focus.
 * The first value is read synchronously so a phone's first render already
 * knows, and no crossing fires on load.
 */
export const usePhoneBreakpoint = (): boolean => {
  const [phone, setPhone] = useState(liveBelowBreakpoint);
  useLayoutEffect(() => {
    const query = matchMedia(
      phoneMediaQuery(getComputedStyle(document.documentElement)),
    );
    const report = () => setPhone(query.matches);
    report();
    query.addEventListener('change', report);
    return () => query.removeEventListener('change', report);
  }, []);
  return phone;
};

const liveBelowBreakpoint = () =>
  typeof window === 'undefined'
    ? false
    : matchMedia(phoneMediaQuery(getComputedStyle(document.documentElement)))
        .matches;
