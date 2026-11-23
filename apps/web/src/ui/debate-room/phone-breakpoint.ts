'use client';

import { useMediaQuery } from '../edge/use-dom-events';
import { useState } from 'react';

/**
 * The room's one phone-layout threshold as a media query: `--breakpoint-compact`
 * in globals.css defines it, the same value the `max-compact:` variant uses
 * and `room.css` repeats in its own media queries. Without the token the documented
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
  // The token is read once; hydration reads the live answer too, so a phone
  // that hydrates already knows and no crossing fires on load.
  const [query] = useState(roomPhoneQuery);
  const [firstMatch] = useState(
    () => query !== null && matchMedia(query).matches,
  );
  return useMediaQuery(query, firstMatch);
};

const roomPhoneQuery = (): string | null =>
  typeof window === 'undefined'
    ? null
    : phoneMediaQuery(getComputedStyle(document.documentElement));
