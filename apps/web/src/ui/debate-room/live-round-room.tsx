'use client';

import './zod-jitless';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { systemClock } from '@daisy/clock';
import type { RoundView } from '@daisy/protocol';
import { browserSyncEdges } from '../../features/resource-sync/browser';
import type { RoundRead } from '../../features/rooms/read-round';
import {
  createRoundSyncDriver,
  seedRoundSync,
} from '../../features/rooms/round-sync-driver';
import { FreshnessNotice } from '../resource-sync/freshness-notice';
import { useResourceSync } from '../resource-sync/use-resource-sync';
import type { LeaveLinks } from './leave-room';
import { isLiveDebater, liveRoundOf } from './live-round';
import { DebateRoom } from './room';
import { useRoundSync } from './use-round-sync';

const nowMs = () => Date.parse(systemClock.now());

/**
 * The browser's clock, read once a second: the clock edge of the live room.
 * It starts from the server's render instant so hydration matches.
 */
function useSecond(renderedAtMs: number): number {
  const [now, setNow] = useState(renderedAtMs);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowMs()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * The mounted round room: the position derived each second from the
 * round's durable snapshot, the snapshot kept current by round sync from
 * its doorbell and reads, never by re-rendering the route (ADR 0066), and
 * the debater's files saved on the persisted Round. A round this debater no
 * longer debates live leaves for its receipt.
 */
export function LiveRoundRoom({
  view: seed,
  actorId,
  renderedAtMs,
  leave,
  read,
  socketUrl,
}: {
  readonly view: RoundView;
  readonly renderedAtMs: number;
  readonly actorId: string;
  readonly leave: LeaveLinks;
  readonly read: () => Promise<RoundRead>;
  /** The realtime endpoint, or null when realtime is not configured. */
  readonly socketUrl: string | null;
}) {
  const start = useCallback(
    () =>
      createRoundSyncDriver({
        seed: seedRoundSync(seed, 0),
        read,
        ...browserSyncEdges(socketUrl),
      }),
    [seed, read, socketUrl],
  );
  const [synced] = useResourceSync(() => seedRoundSync(seed, 0), start);
  const view = synced.value;
  const router = useRouter();
  const ended = !isLiveDebater(view, actorId);
  useEffect(() => {
    if (ended) router.replace(`/rounds/${view.id}`);
  }, [ended, router, view.id]);
  const now = useSecond(renderedAtMs);
  const round = useMemo(
    () => liveRoundOf(view, actorId, now),
    [view, actorId, now],
  );
  const { sync, notice, save } = useRoundSync(view.id);
  return (
    <>
      <FreshnessNotice freshness={synced.freshness} noun="round" />
      {round ? (
        <DebateRoom
          round={round}
          sync={sync}
          notice={notice}
          save={save}
          leave={leave}
        />
      ) : null}
    </>
  );
}
