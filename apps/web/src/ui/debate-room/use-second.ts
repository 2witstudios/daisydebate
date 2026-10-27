'use client';
import { systemClock } from '@daisy/clock';
import { useEffect, useState } from 'react';

const nowMs = () => Date.parse(systemClock.now());

/**
 * The browser's clock, read once a second: the clock edge of a live view.
 * It starts from the server's render instant so hydration matches.
 */
export function useSecond(renderedAtMs: number): number {
  const [now, setNow] = useState(renderedAtMs);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowMs()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
