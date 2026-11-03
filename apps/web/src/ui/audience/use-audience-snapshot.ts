'use client';
import '../../lib/zod-jitless';
import { audienceSnapshotSchema, type AudienceSnapshot } from '@daisy/protocol';
import { useEffect, useState } from 'react';
import { answerOfResponse } from '../../features/spectating/poll-pace';
import { startBrowserPoll } from '../spectating/browser-poll';
import { newerAudience } from './newer-audience';

/**
 * The audience's activity, refreshed from the read everyone gets, and from a fresh
 * render as soon as there is one, so a poster sees their own message at once. Off,
 * it makes no request. Without script the server's render stands. Only an unlisted
 * Round sends cookies, for its link: a public read needs none, so it stays cacheable.
 * A refusal or a failed read backs off, and the last view stands until one succeeds.
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
    const stop = startBrowserPoll(async () => {
      const response = await fetch(
        `/api/rounds/${encodeURIComponent(initial.roundId)}/audience`,
        { credentials: unlisted ? 'same-origin' : 'omit' },
      );
      const parsed = audienceSnapshotSchema.safeParse(
        response.ok ? await response.json() : null,
      );
      if (parsed.success && !stopped)
        setSnapshot((shown) => newerAudience(shown, parsed.data));
      return answerOfResponse(response);
    });
    return () => {
      stopped = true;
      stop();
    };
  }, [initial.roundId, polling, unlisted]);
  return snapshot;
}
