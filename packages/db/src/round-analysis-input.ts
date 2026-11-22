import { createAppError } from '@daisy/errors';
import {
  roundAnalysisLimits,
  type RoundAnalysisSkill,
} from '@daisy/protocol/round-analysis';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { RoundAnalysisAccess } from './round-analysis-access';
import type { AnalysisSeat } from './round-analysis-authority';
import { readLockedFrozenRoundTranscript } from './frozen-transcript';
import { roundAnalyses } from './schema/round-analyses';
import { roundParticipants } from './schema/round-participants';
import { seatOfColumns } from './seat-columns';
import { roundSegments } from './schema/round-segments';
import { rounds } from './schema/rounds';
import type { Tx } from './tx';

/** Own retained skill scores only, from earlier completed Rounds; never ballots. */
async function analysisHistory(tx: Tx, seat: AnalysisSeat, actorId: string) {
  const rows = await tx
    .select({ work: roundAnalyses.work })
    .from(roundAnalyses)
    .innerJoin(
      roundParticipants,
      eq(roundParticipants.id, roundAnalyses.roundParticipantId),
    )
    .innerJoin(rounds, eq(rounds.id, roundAnalyses.roundId))
    .where(
      and(
        eq(roundParticipants.actorId, actorId),
        sql`${roundAnalyses.work}->>'kind' in ('retained','succeeded')`,
        sql`${rounds.completedAt} < (select completed_at from rounds where id=${seat.roundId})`,
      ),
    )
    .orderBy(desc(rounds.completedAt))
    .limit(roundAnalysisLimits.history);
  return rows.flatMap(({ work }) =>
    'report' in work
      ? [
          Object.fromEntries(
            Object.entries(work.report.skills).map(([skill, { score }]) => [
              skill,
              score,
            ]),
          ) as Record<RoundAnalysisSkill, number>,
        ]
      : [],
  );
}

/** Read only inside the current dispatch fence; no claim-time input survives a later purge. */
export async function readAnalysisInput(
  tx: Tx,
  seat: AnalysisSeat,
  access: RoundAnalysisAccess,
) {
  const frozen = await readLockedFrozenRoundTranscript(tx, seat.roundId);
  if (!frozen?.utterances.length)
    throw createAppError('CONFLICT', 'Analysis evidence unavailable');
  const [round] = await tx
    .select({ resolution: rounds.resolution, rules: rounds.rulesSnapshot })
    .from(rounds)
    .where(eq(rounds.id, seat.roundId));
  if (!round?.resolution) throw createAppError('INVARIANT');
  const participants = (
    await tx
      .select({
        id: roundParticipants.id,
        seatKind: roundParticipants.seatKind,
        side: roundParticipants.side,
        slot: roundParticipants.slot,
      })
      .from(roundParticipants)
      .where(eq(roundParticipants.roundId, seat.roundId))
  ).map(({ id, ...row }) => ({ id, seat: seatOfColumns(row) }));
  const segments = await tx
    .select({ id: roundSegments.id, sequence: roundSegments.sequence })
    .from(roundSegments)
    .where(eq(roundSegments.roundId, seat.roundId))
    .orderBy(asc(roundSegments.sequence));
  return {
    seat: {
      ...seat,
      seat: {
        kind: 'side' as const,
        side: access.seat.side,
        slot: access.seat.slot,
      },
    },
    /** The Round's sides, so the analysed seat is named by its side's label. */
    sides: round.rules.sides,
    round: {
      id: seat.roundId,
      resolution: round.resolution,
      participants,
      segments,
    },
    frozen,
    history: await analysisHistory(tx, seat, access.seat.actorId),
  };
}
