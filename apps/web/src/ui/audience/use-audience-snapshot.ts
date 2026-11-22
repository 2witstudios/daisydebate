'use client';
import '../../lib/zod-jitless';
import { useBrowserEffect } from '../edge/browser-sync';
import { browserFetch } from '../edge/browser-request';
import {
  audienceSnapshotSchema,
  type AudienceSnapshot,
} from '@daisy/protocol/audience';
import { useState } from 'react';
import { answerOfResponse } from '../../features/spectating/poll-pace';
import { startBrowserPoll } from '../spectating/browser-poll';
import { usePublishedAudience } from '../spectating/published-state';
import { newerAudience } from './newer-audience';

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
  useBrowserEffect(() => {
    if (!polling || !liveRoom) return;
    let stopped = false;
    const stop = startBrowserPoll(async () => {
      const response = await browserFetch(
        `/api/rounds/${encodeURIComponent(initial.roundId)}/audience`,
        { credentials: 'same-origin' },
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
  }, [initial.roundId, polling, liveRoom]);
  return snapshot;
}
