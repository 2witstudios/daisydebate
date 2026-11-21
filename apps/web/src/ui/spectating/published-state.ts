'use client';
import { useBrowserEffect } from '../edge/browser-sync';
import { browserFetch } from '../edge/browser-request';
import '../../lib/zod-jitless';
import { audienceStateSchema, type AudienceState } from '@daisy/protocol';
import { createContext, useContext, useState } from 'react';
import { answerOfResponse } from '../../features/spectating/poll-pace';
import { startBrowserPoll } from './browser-poll';
import {
  firstPublishedReads,
  nextPublishedReads,
  paceOfPublishedRead,
  serverAsksOf,
  type PublishedRead,
} from './published-state-model';

const READ_TIMEOUT_MS = 5_000;

/** What this tab has read from one address. */
type Held = {
  readonly url: string;
  readonly state: AudienceState | null;
  readonly sinceMovedMs: number;
  readonly serverAsks: number;
};

/** What a page holds of one address: nothing read yet reads as no state. */
export type PublishedState = Omit<Held, 'url'>;

const NOTHING_READ: PublishedState = {
  state: null,
  sinceMovedMs: 0,
  serverAsks: 0,
};

/**
 * Polls a Round's published state from the public bucket. No cookie goes with it. Every
 * attempt, answered or not, updates how long the object has stood still, measured here
 * on the tab's own clock. `serverAsks` counts the requested server refreshes
 * during a run of missing reads. What was read
 * belongs to its address: a replaced link starts from nothing. While an address is gone
 * the reads go on, so one that comes back is seen, but slow down as misses do.
 * The page says, of what has been read, whether there is anything left to read for.
 */
export function usePublishedState(
  url: string | null,
  keepReading: (published: PublishedState) => boolean,
  recheckBeforePublication = false,
): PublishedState {
  const [held, setHeld] = useState<Held | null>(null);
  const published = held !== null && held.url === url ? held : NOTHING_READ;
  const polling = keepReading(published);
  useBrowserEffect(() => {
    if (!url || !polling) return;
    let stopped = false;
    let reads = firstPublishedReads(performance.now());
    const settle = (read: PublishedRead) => {
      if (stopped) return;
      const now = performance.now();
      reads = nextPublishedReads(reads, read, now, recheckBeforePublication);
      setHeld({
        url,
        state: reads.state,
        serverAsks: serverAsksOf(reads),
        sinceMovedMs: now - reads.movedAtMs,
      });
    };
    const stop = startBrowserPoll(async () => {
      try {
        const response = await browserFetch(url, {
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
        return paceOfPublishedRead(reads, answerOfResponse(response));
      } catch (error) {
        settle({ kind: 'failed' });
        throw error;
      }
    });
    return () => {
      stopped = true;
      stop();
    };
  }, [url, polling, recheckBeforePublication]);
  return published;
}

/** The published state for what sits beside the player; null with none. */
export const PublishedAudience = createContext<AudienceState | null>(null);
export const usePublishedAudience = () => useContext(PublishedAudience);
