'use client';
import { createId } from '@paralleldrive/cuid2';
import { tabPulses, VIEWER_PULSE_MS } from '@daisy/protocol';
import { useEffect, useRef } from 'react';
import { usePublishedAudience } from '../spectating/published-state';

/**
 * Says this tab is watching, so the count can gather. The published state says what
 * share of tabs should, and this tab draws once and keeps its draw, so a large
 * audience stays a small load on web and the count can be scaled back up (DEC-350).
 * The token is random and lives only as long as the mounted page: no account, nothing
 * stored, and no cookie except an unlisted Round's link, which names the Round and
 * no one.
 */
export function ViewerPulse({
  roundId,
  unlisted,
}: {
  readonly roundId: string;
  readonly unlisted: boolean;
}) {
  const published = usePublishedAudience()?.pulseRate ?? 1;
  const rate = useRef(published);
  useEffect(() => {
    rate.current = published;
  }, [published]);
  useEffect(() => {
    const token = createId();
    const draw = crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
    const pulse = () => {
      if (!tabPulses(draw, rate.current)) return;
      void fetch(`/api/rounds/${encodeURIComponent(roundId)}/viewers`, {
        method: 'POST',
        credentials: unlisted ? 'same-origin' : 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, token }),
      }).catch(() => undefined);
    };
    pulse();
    const timer = setInterval(pulse, VIEWER_PULSE_MS);
    return () => clearInterval(timer);
  }, [roundId, unlisted]);
  return null;
}
