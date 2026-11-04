'use client';
import '../../lib/zod-jitless';
import { audienceStateSchema, type AudienceState } from '@daisy/protocol';
import { createContext, useContext, useEffect, useState } from 'react';
import { answerOfResponse } from '../../features/spectating/poll-pace';
import { startBrowserPoll } from './browser-poll';
import {
  firstPublishedReads,
  nextPublishedReads,
  type PublishedRead,
} from './published-state-model';

const READ_TIMEOUT_MS = 5_000;

/**
 * Polls a Round's published state from the public bucket. No cookie goes with it. Every
 * attempt, answered or not, updates how long the object has stood still, measured here
 * on the tab's own clock. `gone` asks the page to read the server again.
 */
export function usePublishedState(url: string | null, polling: boolean) {
  const [state, setState] = useState<AudienceState | null>(null);
  const [sinceMovedMs, setSinceMovedMs] = useState(0);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!url || !polling) return;
    let stopped = false;
    let reads = firstPublishedReads(performance.now());
    const settle = (read: PublishedRead) => {
      if (stopped) return;
      const now = performance.now();
      reads = nextPublishedReads(reads, read, now);
      setState(reads.state);
      setGone(reads.gone);
      setSinceMovedMs(now - reads.movedAtMs);
    };
    const stop = startBrowserPoll(async () => {
      try {
        const response = await fetch(url, {
          cache: 'no-store',
          credentials: 'omit',
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        });
        const parsed = audienceStateSchema.safeParse(
          response.ok ? await response.json() : null,
        );
        settle(
          parsed.success
            ? { kind: 'state', state: parsed.data }
            : response.status === 404 || response.status === 403
              ? { kind: 'missing' }
              : { kind: 'failed' },
        );
        return answerOfResponse(response);
      } catch (error) {
        settle({ kind: 'failed' });
        throw error;
      }
    });
    return () => {
      stopped = true;
      stop();
    };
  }, [url, polling]);
  return { state, sinceMovedMs, gone };
}

/** The published state for what sits beside the player; null with none. */
export const PublishedAudience = createContext<AudienceState | null>(null);
export const usePublishedAudience = () => useContext(PublishedAudience);
