import {
  isDebatingSeat,
  sideOfSeat,
  type SeatRef,
} from '@daisy/protocol/seats';
import {
  type DebateRecord,
  type RecordResult,
} from '@daisy/protocol/member-profile';
import { type RoundOutcome } from '@daisy/protocol/round-outcome';
import { type RoundStatus } from '@daisy/protocol/round';

/** A Round as a debater's record reads it: its state and canonical outcome. */
type RecordedRound = {
  readonly status: RoundStatus;
  readonly outcome: RoundOutcome | null;
};

/**
 * The one rule for what a Round means to one seat's record (ISSUE-600).
 * Only a completed Round counts, and only for a debating seat. The outcome
 * names the side that won; a forfeit completes with the other
 * side's outcome, so it is a win for the side that stayed and a loss for
 * the forfeiter. A completed Round with no winner (no outcome, or a ranking,
 * which names no loser) is `no-ruling`, never a loss: a loss needs the other
 * side named. Abandoned, scheduled and live Rounds, and the seats of judges
 * and moderators, are not part of the record (null).
 */
export function recordResult(
  round: RecordedRound,
  seat: SeatRef,
): RecordResult | null {
  if (round.status !== 'completed' || !isDebatingSeat(seat)) return null;
  if (round.outcome?.kind !== 'winner') return 'no-ruling';
  return round.outcome.side === sideOfSeat(seat) ? 'win' : 'loss';
}

/** A debater's record from Rounds grouped by state, outcome and seat. */
export function tallyRecord(
  groups: readonly (RecordedRound & {
    readonly seat: SeatRef;
    readonly rounds: number;
  })[],
): DebateRecord {
  return groups.reduce<DebateRecord>(
    (record, group) => {
      const result = recordResult(group, group.seat);
      if (result === 'win')
        return { ...record, wins: record.wins + group.rounds };
      if (result === 'loss')
        return { ...record, losses: record.losses + group.rounds };
      return record;
    },
    { wins: 0, losses: 0 },
  );
}
