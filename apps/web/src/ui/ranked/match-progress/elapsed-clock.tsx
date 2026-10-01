'use client';

import { formatElapsed } from './seconds';
import { useElapsedSeconds } from './use-elapsed-seconds';

/** How long the search has run; counts up once hydrated, reads 0:00 before. */
export function ElapsedClock() {
  const seconds = useElapsedSeconds();
  return (
    <span className="font-display text-3xl leading-none font-bold tabular-nums">
      <span className="sr-only">Searching for </span>
      {formatElapsed(seconds)}
    </span>
  );
}
