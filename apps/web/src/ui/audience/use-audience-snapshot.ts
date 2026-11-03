'use client';
import '../../lib/zod-jitless';
import { audienceSnapshotSchema, type AudienceSnapshot } from '@daisy/protocol';
import { useEffect, useState } from 'react';
import { newerAudience } from './newer-audience';

const POLL_MS = 2000;

/**
 * The audience's activity, refreshed from the read everyone gets, and from a fresh
 * render as soon as there is one, so a poster sees their own message at once. Off,
 * it makes no request. Without script the server's render stands. Only an unlisted
 * Round sends cookies, for its link: a public read needs none, so it stays cacheable.
 */
export function useAudienceSnapshot(
  initial: AudienceSnapshot,
  polling: boolean,
  unlisted: boolean,
) {
  const [snapshot, setSnapshot] = useState(initial);
  const [rendered, setRendered] = useState(initial);
  if (rendered !== initial) {
    setRendered(initial);
    setSnapshot(newerAudience(snapshot, initial));
  }
  useEffect(() => {
    if (!polling) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/rounds/${encodeURIComponent(initial.roundId)}/audience`,
          { credentials: unlisted ? 'same-origin' : 'omit' },
        );
        const parsed = audienceSnapshotSchema.safeParse(
          response.ok ? await response.json() : null,
        );
        if (parsed.success && !stopped)
          setSnapshot((shown) => newerAudience(shown, parsed.data));
      } catch {
        // The last view stands until a read succeeds again.
      }
    };
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [initial.roundId, polling, unlisted]);
  return snapshot;
}
