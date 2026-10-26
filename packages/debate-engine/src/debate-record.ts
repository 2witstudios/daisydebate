import type {
  DebateRecord,
  DebateRole,
  RatedOutcome,
  RecordResult,
  RoundStatus,
} from '@daisy/protocol';

/** A Round as a debater's record reads it: its state and canonical outcome. */
type RecordedRound = {
  readonly status: RoundStatus;
  readonly outcome: RatedOutcome | null;
};

/**
 * The one rule for what a Round means to one seat's record (ISSUE-600).
 * Only a completed Round counts, and only for a debating seat. The outcome
 * names the side that won or a draw; a forfeit completes with the other
 * side's outcome, so it is a win for the side that stayed and a loss for
 * the forfeiter. A completed Round with no outcome is `no-ruling`, never a
 * loss: a loss needs the other side named. Abandoned, scheduled and live
 * Rounds, and judge seats, are not part of the record (null).
 */
export function recordResult(
  round: RecordedRound,
  role: DebateRole,
): RecordResult | null {
  if (round.status !== 'completed' || role === 'judge') return null;
  if (round.outcome === null) return 'no-ruling';
  if (round.outcome === 'draw') return 'draw';
  return round.outcome === role ? 'win' : 'loss';
}

/** A debater's record from Rounds grouped by state, outcome and seat role. */
export function tallyRecord(
  groups: readonly (RecordedRound & {
    readonly role: DebateRole;
    readonly rounds: number;
  })[],
): DebateRecord {
  return groups.reduce<DebateRecord>(
    (record, group) => {
      const result = recordResult(group, group.role);
      if (result === 'win')
        return { ...record, wins: record.wins + group.rounds };
      if (result === 'loss')
        return { ...record, losses: record.losses + group.rounds };
      if (result === 'draw')
        return { ...record, draws: record.draws + group.rounds };
      return record;
    },
    { wins: 0, losses: 0, draws: 0 },
  );
}
