'use client';

import type { LeaveLinks } from './leave-room';
import { DebateRoom } from './room';
import type { RoundSnapshot } from './round';
import { useRoundSync } from './use-round-sync';

/** The mounted round room: the debater's files saved on the persisted Round. */
export function LiveRoundRoom({
  roundId,
  round,
  leave,
}: {
  readonly roundId: string;
  readonly round: RoundSnapshot;
  readonly leave: LeaveLinks;
}) {
  const { sync, notice, save } = useRoundSync(roundId);
  return (
    <DebateRoom
      round={round}
      sync={sync}
      notice={notice}
      save={save}
      leave={leave}
    />
  );
}
