'use client';

import { useTick } from '../../edge/use-tick';
import { useState } from 'react';
import { clockLabel } from '../../../features/watch/labels';

export type LiveClockProps = {
  /** Seconds left when the page rendered: what shows before hydration. */
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
  useTick(() => setSeconds((left) => Math.max(0, left - 1)), 1000);
  return (
    <span role="timer" className={className}>
      {clockLabel(seconds)}
    </span>
  );
}
