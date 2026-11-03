'use client';
import { createId } from '@paralleldrive/cuid2';
import { useEffect } from 'react';

const PULSE_MS = 25_000;

/**
 * Says this tab is watching, so the count can gather. The token is random and
 * lives only as long as the mounted page: no cookie, no account, nothing stored.
 * A reader without script is not counted, and a failed pulse is a smaller count.
 */
export function ViewerPulse({ roundId }: { readonly roundId: string }) {
  useEffect(() => {
    const token = createId();
    const pulse = () =>
      void fetch(`/api/rounds/${encodeURIComponent(roundId)}/viewers`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, token }),
      }).catch(() => undefined);
    pulse();
    const timer = setInterval(pulse, PULSE_MS);
    return () => clearInterval(timer);
  }, [roundId]);
  return null;
}
