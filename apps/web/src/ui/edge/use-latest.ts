'use client';

import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Reads a rendered value at its latest from outside render: a resource
 * opened once still calls the owner's current handlers. The getter answers
 * the last committed value, and the value the owner first rendered with
 * before that.
 */
export function useLatest<T>(value: T): () => T {
  const latest = useRef(value);
  useLayoutEffect(() => {
    latest.current = value;
  });
  const [read] = useState(() => () => latest.current);
  return read;
}
