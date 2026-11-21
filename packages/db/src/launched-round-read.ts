import { roundSourceVoided } from './round-source-state';
import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { LaunchedRound } from '@daisy/protocol';
import { currentRoundParticipant } from './round-current-participant';
import { roundLifecycleOfRow, segmentRows } from './round-hydration';
import { actorFact } from './room-command-facts';
import { seatOfColumns, seatRowOrder } from './seat-columns';
import { rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';
import { mediaSessions } from './schema/media-sessions';
import { roundTranscriptFreezes } from './schema/round-transcript-freezes';
import { roundCommands } from './schema/round-commands';
import { recordedPanelRuling } from './round-panel-decisions';
import { roundResolutionAudit } from './room-draw-persistence';
import { readableCheckpoint } from './round-view-projection';
import type { Tx } from './tx';

/**
 * Whether the Round's post-round call still stands (ADR 0127): chosen, and
 * not on a Round whose media session has ended. A completed Round's session
 * ends when its call does, so a view of it stops offering the call then.
 */
async function postRoundCallStands(
  tx: Tx,
  round: Pick<typeof rounds.$inferSelect, 'id' | 'status' | 'postRoundCall'>,
) {
  if (!round.postRoundCall || round.status !== 'completed')
    return round.postRoundCall;
  const [session] = await tx
    .select({
      endedAt: mediaSessions.endedAt,
      sourceVoided: roundSourceVoided(round.id),
    })
    .from(mediaSessions)
    .where(eq(mediaSessions.roundId, round.id));
  return (
    session !== undefined && session.endedAt === null && !session.sourceVoided
  );
}

export async function launchedRoundRows(
  tx: Tx,
  roundId: string,
): Promise<LaunchedRound> {
  const [row] = await tx
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .for('share');
  if (!row || !row.roomId || !row.roomConfigSnapshot || !row.visibility)
    throw createAppError('NOT_FOUND');
  const seats = await tx
    .select()
    .from(roundParticipants)
    .where(
      and(
        eq(roundParticipants.roundId, roundId),
        currentRoundParticipant(roundParticipants.id),
      ),
    )
    .orderBy(...seatRowOrder(roundParticipants));
  const participants = await Promise.all(
    seats.map(async (p) => {
      const actor = await actorFact(tx, p.actorId);
      if (!actor) throw createAppError('INVARIANT');
      return {
        id: p.id,
        actorId: actor.actorId,
        kind: actor.kind,
        label: actor.label,
        seat: seatOfColumns(p),
      };
    }),
  );
  const lifecycle = roundLifecycleOfRow(row);
  const round: LaunchedRound = {
    ...lifecycle,
    id: row.id,
    roomId: row.roomId,
    version: row.version,
    competitionType: row.competitionType,
    ladder:
      row.ladderId === null || row.ladderDivision === null
        ? null
        : { style: row.ladderId, division: row.ladderDivision },
    topic: row.resolution,
    visibility: row.visibility,
    hostActorId: row.createdByActorId,
    hostInherited: row.hostInherited,
    config: row.roomConfigSnapshot,
    rules: row.rulesSnapshot,
    participants,
    postRoundCall: await postRoundCallStands(tx, row),
    platformEnding: row.platformEnding,
    // A ruling belongs to a panel completion: a Round that is not completed carries none.
    panelRuling:
      lifecycle.status !== 'completed'
        ? null
        : recordedPanelRuling(
            await tx
              .select()
              .from(roundCommands)
              .where(
                and(
                  eq(roundCommands.roundId, roundId),
                  eq(roundCommands.type, 'complete'),
                ),
              ),
          ),
    transcriptCompleteness:
      (
        await tx
          .select({ completeness: roundTranscriptFreezes.completeness })
          .from(roundTranscriptFreezes)
          .where(eq(roundTranscriptFreezes.roundId, roundId))
      )[0]?.completeness ?? null,
    resolutionAudit: await roundResolutionAudit(tx, row),
    checkpoint: readableCheckpoint(row.runtimeState),
    segments: await segmentRows(tx, roundId),
  };
  return round;
}
