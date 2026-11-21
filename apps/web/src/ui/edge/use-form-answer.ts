'use client';

import { useEffect, useEffectEvent, useRef } from 'react';

/** Delivers a committed answer once, leaving the server-rendered seed alone. */
export function useFormAnswer<S>(
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
