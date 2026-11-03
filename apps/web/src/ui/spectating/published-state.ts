'use client';
import '../../lib/zod-jitless';
import { audienceStateSchema, type AudienceState } from '@daisy/protocol';
import { createContext, useContext, useEffect, useState } from 'react';
import { answerOfResponse } from '../../features/spectating/poll-pace';
import { startBrowserPoll } from './browser-poll';

/**
 * Polls a Round's published state from the public bucket. No cookie goes with it. A
 * missing object is not an answer about the Round: it may not be out yet, so the poll
 * keeps going and the last state stands. How long the object has stood still is
 * measured here, on the tab's own clock.
 */
export function usePublishedState(url: string | null, polling: boolean) {
  const [state, setState] = useState<AudienceState | null>(null);
  const [sinceMovedMs, setSinceMovedMs] = useState(0);
  useEffect(() => {
    if (!url || !polling) return;
    let stopped = false;
    let lastPublished = -1;
    let movedAt = Date.now();
    const stop = startBrowserPoll(async () => {
      const response = await fetch(url, {
        cache: 'no-store',
        credentials: 'omit',
      });
      const parsed = audienceStateSchema.safeParse(
        response.ok ? await response.json() : null,
      );
      if (stopped) return answerOfResponse(response);
      if (parsed.success && parsed.data.publishedAtMs !== lastPublished) {
        lastPublished = parsed.data.publishedAtMs;
        movedAt = Date.now();
        setState(parsed.data);
      }
      setSinceMovedMs(Date.now() - movedAt);
      return answerOfResponse(response);
    });
    return () => {
      stopped = true;
      stop();
    };
  }, [url, polling]);
  return { state, sinceMovedMs };
}

/** The published state for what sits beside the player; null with none. */
export const PublishedAudience = createContext<AudienceState | null>(null);
export const usePublishedAudience = () => useContext(PublishedAudience);
