import { requireCurrentWeb } from './web-service-authority';
import { endOpenJudgingJobs, type JudgingEndRule } from './round-judging-end';
import { createAppError } from '@daisy/errors';
import { idSchema, type JudgingTerminalReason } from '@daisy/protocol';
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
  requireAttendanceTarget,
  requireResolutionProjection,
  type AttendanceResolution,
  type NextAttendanceWindow,
} from './attendance-adjudication';

/**
 * The read is capped, so an old window can still be decided on what it proves.
 * A read at the cap fits the transaction slice on local PostgreSQL; staging is
 * unmeasured (ADR 0095).
 */
async function withEvidence(
  tx: AttendanceTransactionContext,
  facts: AttendanceReceiptFacts,
  finalizedSegmentIds: readonly string[],
  nextWindow: NextAttendanceWindow,
): Promise<AttendanceEvaluationFacts> {
  return {
    ...facts,
    samples: await attendanceSamples(
      tx,
      nextWindow({
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
};
/** What one attendance pass found. */
export type AttendanceEvaluation =
  | { readonly kind: 'undecided' }
  /** An uncertain check-in writer holds every decision, including the cutoff. */
  | { readonly kind: 'held'; readonly reason: 'pending_writer' }
  /** While a platform incident holds the Round, nobody's absence can be judged. */
  | { readonly kind: 'held'; readonly reason: 'platform_incident' }
  | { readonly kind: 'decided'; readonly resolution: AttendanceResolution };
/** One Round fence, immutable ordered receipts, and the SAME engine projection/history/outbox writer. */
export function createAttendanceEvaluator(transaction: AttendanceTransaction) {
  return async (input: {
    readonly roundId: string;
    readonly commandId: string;
    readonly instanceId: string;
    /** An AI job this decision found out of budget, with no worker to report it. */
    readonly judgingEnded?: (reason: JudgingTerminalReason) => void;
    /** The engine's speech-order rule. */
    readonly nextWindow: NextAttendanceWindow;
    /** Judging, not attendance, names why the Round's end ended a job. */
    readonly judgingEndReason: JudgingEndRule;
    /** Decided first, with no history read: the common case stays cheap. */
    readonly resolveOnReceipts: (
      facts: AttendanceReceiptFacts,
    ) => AttendanceResolution | null;
    readonly resolve: (
      facts: AttendanceEvaluationFacts,
    ) => AttendanceResolution | null;
  }): Promise<AttendanceEvaluation> => {
    if (
      ![input.roundId, input.commandId, input.instanceId].every(
        (id) => idSchema.safeParse(id).success,
      )
    )
      throw createAppError('VALIDATION');
    let ended: readonly JudgingTerminalReason[] = [];
    const outcome = await transaction(
      async (tx): Promise<AttendanceEvaluation> => {
        await requireCurrentWeb(tx, input.instanceId);
        const { current, round, seats } = await fenceAttendance(
          tx,
          input.roundId,
          input.commandId,
          null,
        );
        await requireCurrentWeb(tx, input.instanceId, true);
        if (round.checkpoint.incident.phase !== 'none')
          return { kind: 'held', reason: 'platform_incident' };
        const pending = await tx.execute(
          sql`select attempt_id from round_check_in_attempts where round_id=${round.id} and state='pending' limit 1`,
        );
        if (pending.length > 0)
          return { kind: 'held', reason: 'pending_writer' };
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
          input.resolve(
            await withEvidence(
              tx,
              facts,
              finalizedSegmentIds,
              input.nextWindow,
            ),
          );
        if (!resolution) return { kind: 'undecided' };
        const target = requireAttendanceTarget(
          input.nextWindow,
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
        if (resolution.projection)
          ended = await endOpenJudgingJobs(tx, {
            roundId: round.id,
            ending: resolution.decision === 'forfeit' ? 'forfeit' : 'abandoned',
            now,
            judgingEndReason: input.judgingEndReason,
          });
        await requireCurrentWeb(tx, input.instanceId);
        return { kind: 'decided', resolution };
      },
    );
    // After commit.
    for (const reason of ended) input.judgingEnded?.(reason);
    return outcome;
  };
}
