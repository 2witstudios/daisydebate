'use client';

import { useEffect, useEffectEvent, useRef } from 'react';

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
