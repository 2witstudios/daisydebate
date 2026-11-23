'use client';

import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';

/**
 * Delivers each new value once it has rendered, never the value the page was
 * rendered with: a form's committed answer, or any value whose change a
 * consumer is told about. The handler is read at its latest.
 */
export function useAnswer<S>(
  answer: S,
  onAnswer: ((answer: S) => void) | undefined,
): void {
  const seen = useRef(answer);
  const deliver = useEffectEvent((next: S) => onAnswer?.(next));
  useEffect(() => {
    if (Object.is(seen.current, answer)) return;
    seen.current = answer;
    deliver(answer);
  }, [answer]);
}

/**
 * Hands every rendered value to a consumer outside React, the first one
 * included: an editor's options, a resource's view, a control's validity.
 * The consumer is read at its latest; nothing is cleaned up, because a
 * delivery holds nothing open.
 */
export function useDeliver<S>(value: S, deliver: (value: S) => void): void {
  const send = useEffectEvent(deliver);
  useEffect(() => {
    send(value);
  }, [value]);
}

/**
 * Hands every rendered value to a layout consumer before the browser paints,
 * the first one included: a scroll position kept at the end of what just
 * rendered. The consumer is read at its latest and holds nothing open.
 */
export function useDeliverBeforePaint<S>(
  value: S,
  deliver: (value: S) => void,
): void {
  const send = useEffectEvent(deliver);
  useLayoutEffect(() => {
    send(value);
  }, [value]);
}

/**
 * Calls `handle` once, when its owner leaves the page, reading the handler
 * at its latest: a last word to a parent, never a resource to release.
 */
export function useLeave(handle: () => void): void {
  const leave = useEffectEvent(handle);
  useEffect(() => () => leave(), []);
}
