'use client';

import './zod-jitless';
import { useEffect, useMemo, useState } from 'react';
import { systemClock } from '@daisy/clock';
import type { RoundView } from '@daisy/protocol';
import { RoomRefresher } from '../rooms/room-page/room-refresher';
import type { LeaveLinks } from './leave-room';
import { liveRoundOf } from './live-round';
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
 * round's durable snapshot, the snapshot reread from the server every few
 * seconds (an ended round then leaves for its receipt), and the debater's
 * files saved on the persisted Round.
 */
export function LiveRoundRoom({
  view,
  actorId,
  renderedAtMs,
  leave,
}: {
  readonly view: RoundView;
  readonly renderedAtMs: number;
  readonly actorId: string;
  readonly leave: LeaveLinks;
}) {
  const now = useSecond(renderedAtMs);
  const round = useMemo(
    () => liveRoundOf(view, actorId, now),
    [view, actorId, now],
  );
  const { sync, notice, save } = useRoundSync(view.id);
  return (
    <>
      <RoomRefresher />
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
