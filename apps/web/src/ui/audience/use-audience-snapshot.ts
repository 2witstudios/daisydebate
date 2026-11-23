'use client';
import '../../lib/zod-jitless';
import {
  browserTransport,
  type BrowserTransport,
} from '../edge/browser-request';
import { useResource } from '../edge/use-driver';
import {
  audienceSnapshotSchema,
  type AudienceSnapshot,
} from '@daisy/protocol/audience';
import { useState } from 'react';
import { answerOfResponse } from '../../features/spectating/poll-pace';
import { startBrowserPoll } from '../spectating/browser-poll';
import { browserScheduler } from '../edge/browser-time';
import { usePublishedAudience } from '../spectating/published-state';
import { newerAudience } from './newer-audience';

/** The live room's own audience read, signed in. */
const readAudience = (fetch: BrowserTransport, roundId: string) =>
  fetch(`/api/rounds/${encodeURIComponent(roundId)}/audience`, {
    credentials: 'same-origin',
  });

/**
 * The audience's activity, and from a fresh render as soon as there is one, so a
 * poster sees their own message at once. A viewer reads what the worker published
 * beside the player. Someone in the live room reads web, signed in, since what they
 * may see is their own (`audienceFor`). A refusal or a failed read backs off,
 * and the last view stands until one succeeds.
 */
export function useAudienceSnapshot(
  initial: AudienceSnapshot,
  liveRoom: boolean,
  polling: boolean,
) {
  const [snapshot, setSnapshot] = useState(initial);
  const [rendered, setRendered] = useState(initial);
  if (rendered !== initial) {
    setRendered(initial);
    setSnapshot(newerAudience(snapshot, initial));
  }
  const published = usePublishedAudience()?.audience;
  const [seen, setSeen] = useState(published);
  if (!liveRoom && published && published !== seen) {
    setSeen(published);
    setSnapshot(newerAudience(snapshot, published));
  }
  useResource(polling && liveRoom ? initial.roundId : null, (roundId) => {
    if (roundId === null) return null;
    let stopped = false;
    const stop = startBrowserPoll(async () => {
      const response = await readAudience(browserTransport, roundId);
      const parsed = audienceSnapshotSchema.safeParse(
        response.ok ? await response.json() : null,
      );
      if (parsed.success && !stopped)
        setSnapshot((shown) => newerAudience(shown, parsed.data));
      return answerOfResponse(response);
    }, browserScheduler.after);
    return {
      dispose: () => {
        stopped = true;
        stop();
      },
    };
  });
  return snapshot;
}
