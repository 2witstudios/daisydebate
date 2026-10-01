'use client';

import { useEffect, useState } from 'react';

/**
 * Whole seconds since the screen mounted. The one piece of client state on
 * the Ranked page: a display clock, never the source of a transition.
 */
export function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return seconds;
}
