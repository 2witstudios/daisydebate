'use client';

import { useEffect, useState } from 'react';
import { clockLabel } from '../../../features/watch/labels';

export type LiveClockProps = {
  /** Seconds left when the page rendered: what shows with no script. */
  readonly initialSeconds: number;
  readonly className?: string;
};

/**
 * The speech clock, the one piece of client state in the live view. It
 * renders the server's value, then counts down once hydrated; with no
 * script it simply shows the value it was sent.
 */
export function LiveClock({ initialSeconds, className }: LiveClockProps) {
  const [seconds, setSeconds] = useState(initialSeconds);
  useEffect(() => {
    const timer = setInterval(
      () => setSeconds((left) => Math.max(0, left - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <span role="timer" className={className}>
      {clockLabel(seconds)}
    </span>
  );
}
