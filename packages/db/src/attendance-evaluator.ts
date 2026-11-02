import { requireCurrentWeb } from './round-service-authority';
import { endOpenJudgingJobs } from './round-judging-end';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import {
  attendanceSamples,
  fenceAttendance,
  finalizedAttendanceSegments,
  type AttendanceFacts,
  type AttendanceTransaction,
  type AttendanceTransactionContext,
} from './attendance-facts';
import {
  insertCommandRow,
  writeProjectionWithPhaseSignal,
} from './round-projection-writer';
import { writeSpeakingProjection } from './round-speaking-writer';
import { sampleRoundExecutionTime } from './round-execution-time';
import { eligibleCompetitorIds } from './seat-eligibility';
import {
  adjudicationColumns,
  adjudicationCommand,
  nextAttendanceSegment,
  requireAttendanceTarget,
  requireResolutionProjection,
  type AttendanceResolution,
} from './attendance-adjudication';

async function readResolutionCutoff(
  tx: AttendanceTransactionContext,
  roundId: string,
) {
  const [row] = await tx.execute(
    sql`select to_char(attendance_resolution_cutoff_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cutoff from rounds where id=${roundId}`,
  );
  return (row as { cutoff: string | null } | undefined)?.cutoff ?? null;
}

/**
 * Past the cutoff the answer no longer depends on history, so it is not read: a
 * Round whose read overruns its budget must still be able to reach its end.
 */
async function withEvidence(
  tx: AttendanceTransactionContext,
  facts: AttendanceReceiptFacts,
  finalizedSegmentIds: readonly string[],
): Promise<AttendanceEvaluationFacts> {
  const resolutionCutoffAt = await readResolutionCutoff(tx, facts.round.id);
  const pastCutoff =
    resolutionCutoffAt !== null &&
    Date.parse(facts.now) >= Date.parse(resolutionCutoffAt);
  return {
    ...facts,
    resolutionCutoffAt,
    samples: pastCutoff
      ? []
      : await attendanceSamples(
          tx,
          nextAttendanceSegment({
            ruleSegments: facts.round.rules.segments,
            segments: facts.round.segments,
            finalizedSegmentIds,
          })?.startedAt ?? null,
        ),
  };
}

/** Everything but availability history: enough to credit an on-time speaker. */
export type AttendanceReceiptFacts = Omit<AttendanceFacts, 'samples'> & {
  readonly now: string;
  readonly botSeatIds: readonly string[];
  readonly checkIns: readonly {
    readonly participantId: string;
    readonly segmentId: string;
    readonly receivedAt: string;
  }[];
};
export type AttendanceEvaluationFacts = AttendanceReceiptFacts & {
  readonly samples: AttendanceFacts['samples'];
  /** Null until the actual final speech has ended (DEC-276). */
  readonly resolutionCutoffAt: string | null;
};
/** An uncertain check-in writer holds every decision, including the cutoff. */
export type AttendanceHold = {
  readonly decision: 'held';
  readonly reason: 'pending_writer';
};
/** One Round fence, immutable ordered receipts, and the SAME engine projection/history/outbox writer. */
export function createAttendanceEvaluator(transaction: AttendanceTransaction) {
  return async (input: {
    readonly roundId: string;
    readonly commandId: string;
    readonly instanceId: string;
    /** Decided first, with no history read: the common case stays cheap. */
    readonly resolveOnReceipts: (
      facts: AttendanceReceiptFacts,
    ) => AttendanceResolution | null;
    readonly resolve: (
      facts: AttendanceEvaluationFacts,
    ) => AttendanceResolution | null;
  }): Promise<AttendanceResolution | AttendanceHold | null> => {
    if (
      ![input.roundId, input.commandId, input.instanceId].every(
        (id) => idSchema.safeParse(id).success,
      )
    )
      throw createAppError('VALIDATION');
    return transaction(async (tx) => {
      await requireCurrentWeb(tx, input.instanceId);
      const { current, round, seats } = await fenceAttendance(
        tx,
        input.roundId,
        input.commandId,
        null,
      );
      await requireCurrentWeb(tx, input.instanceId, true);
      const pending = await tx.execute(
        sql`select attempt_id from round_check_in_attempts where round_id=${round.id} and state='pending' limit 1`,
      );
      if (pending.length > 0)
        return { decision: 'held', reason: 'pending_writer' };
      const finalizedSegmentIds = await finalizedAttendanceSegments(
        tx,
        round.id,
      );
      const rows = await tx.execute(
        sql`select participant_id,segment_id,to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as received_at from round_check_ins where round_id=${round.id}`,
      );
      const now = await sampleRoundExecutionTime(tx);
      const facts: AttendanceReceiptFacts = {
        round,
        finalizedSegmentIds,
        eligibleParticipantIds: eligibleCompetitorIds(seats),
        now,
        botSeatIds: seats
          .filter((seat) => seat.kind === 'bot')
          .map((seat) => seat.id),
        checkIns: (
          rows as unknown as {
            participant_id: string;
            segment_id: string;
            received_at: string;
          }[]
        ).map((row) => ({
          participantId: row.participant_id,
          segmentId: row.segment_id,
          receivedAt: row.received_at,
        })),
      };
      const resolution =
        input.resolveOnReceipts(facts) ??
        input.resolve(await withEvidence(tx, facts, finalizedSegmentIds));
      if (!resolution) return null;
      const target = requireAttendanceTarget(
        {
          ruleSegments: round.rules.segments,
          segments: round.segments,
          finalizedSegmentIds,
        },
        resolution,
      );
      requireResolutionProjection(resolution);
      await requireCurrentWeb(tx, input.instanceId);
      const changed = resolution.projection
        ? await writeProjectionWithPhaseSignal(
            tx,
            round.id,
            current,
            resolution.projection,
            now,
          )
        : false;
      const resultingVersion = current.version + (changed ? 1 : 0);
      await insertCommandRow(
        tx,
        round.id,
        {
          commandId: input.commandId,
          actorId: null,
          serviceId: `round-attendance:${input.instanceId}`,
          type: 'adjudicate',
          ...adjudicationCommand(round.id, target.id, resolution),
        },
        resultingVersion,
        { before: current.status, projection: resolution.projection },
      );
      const columns = adjudicationColumns(resolution);
      await tx.execute(sql`insert into round_attendance_adjudications(round_id,segment_id,command_id,decision,evidence,effective_deadline,settled_horizon,receipt_participant_id)
    values(${round.id},${target.id},${input.commandId},${resolution.decision},${resolution.evidence},${columns.effectiveDeadline}::timestamptz,${columns.settledHorizon}::timestamptz,${columns.receiptParticipantId})`);
      if (resolution.projection)
        await writeSpeakingProjection(tx, {
          roundId: round.id,
          projection: resolution.projection,
          resultingVersion,
          commandId: input.commandId,
        });
      if (resolution.projection) await endOpenJudgingJobs(tx, round.id);
      await requireCurrentWeb(tx, input.instanceId);
      return resolution;
    });
  };
}
