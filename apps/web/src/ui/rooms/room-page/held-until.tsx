'use client';

import { instantMs, systemClock } from '@daisy/clock';
import { useHydrated } from '../../use-hydrated';

/** "5 h left", "40 min left", or "under a minute left" until `expiresAt`. */
export function timeLeft(expiresAt: string, now: string): string {
  const minutes = Math.floor((instantMs(expiresAt) - instantMs(now)) / 60000);
  if (minutes < 1) return 'under a minute left';
  return minutes < 60
    ? `${minutes} min left`
    : `${Math.floor(minutes / 60)} h left`;
}

/**
 * How long a seat stays held for its invitation (ADR 0124). It reads this
 * device's clock, so the server render leaves it out rather than guess.
 */
export function HeldUntil({ expiresAt }: { readonly expiresAt: string }) {
  return useHydrated() ? (
    <span className="text-ink-faint">
      {` · ${timeLeft(expiresAt, systemClock.now())}`}
    </span>
  ) : null;
}
