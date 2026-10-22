import { requireCurrentWeb } from './round-service-authority';
import { createAppError } from '@daisy/errors';
import { idSchema, type RoundProjection } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import {
  attendanceEvidence,
  fenceAttendance,
  type AttendanceFacts,
  type AttendanceTransaction,
} from './attendance-facts';
import {
  insertCommandRow,
  writeProjectionWithPhaseSignal,
} from './round-projection-writer';
import { writeSpeakingProjection } from './round-speaking-writer';
import { sampleRoundExecutionTime } from './round-execution-time';

export type AttendanceResolution = {
  readonly segmentId: string;
  readonly decision: 'attended' | 'none' | 'forfeit' | 'abandoned';
  readonly effectiveDeadline: string;
  readonly settledHorizon: string;
  readonly projection: RoundProjection | null;
};
export type AttendanceEvaluationFacts = AttendanceFacts & {
  readonly now: string;
  readonly botSeatIds: readonly string[];
  readonly checkIns: readonly {
    readonly participantId: string;
    readonly segmentId: string;
    readonly receivedAt: string;
  }[];
};
/** One Round fence, immutable ordered receipts, and the SAME engine projection/history/outbox writer. */
export function createAttendanceEvaluator(transaction: AttendanceTransaction) {
  return async (input: {
    readonly roundId: string;
    readonly commandId: string;
    readonly instanceId: string;
    readonly resolve: (
      facts: AttendanceEvaluationFacts,
    ) => AttendanceResolution | null;
  }): Promise<AttendanceResolution | null> => {
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
      if (pending.length > 0) return null;
      const evidence = await attendanceEvidence(tx, round);
      const rows = await tx.execute(
        sql`select participant_id,segment_id,to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as received_at from round_check_ins where round_id=${round.id}`,
      );
      const now = await sampleRoundExecutionTime(tx);
      const resolution = input.resolve({
        round,
        ...evidence,
        eligibleParticipantIds: seats
          .filter((seat) => seat.eligible && seat.role !== 'judge')
          .map((seat) => seat.id),
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
      });
      if (!resolution) return null;
      const lastSpeech = round.rules.segments
        .filter((segment) => segment.type === 'speech')
        .at(-1)?.key;
      const target = round.segments.find(
        (segment) =>
          segment.type === 'speech' &&
          segment.rulesSegmentKey !== lastSpeech &&
          !evidence.finalizedSegmentIds.includes(segment.id),
      );
      if (!target || target.id !== resolution.segmentId)
        throw createAppError(
          'INVARIANT',
          'Attendance windows must resolve in actual speech order',
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
          payloadDigest: new Bun.CryptoHasher('sha3-256')
            .update(
              JSON.stringify({
                roundId: round.id,
                segmentId: target.id,
                decision: resolution.decision,
              }),
            )
            .digest('hex'),
          result: {
            segmentId: target.id,
            decision: resolution.decision,
            effectiveDeadline: resolution.effectiveDeadline,
            settledHorizon: resolution.settledHorizon,
          },
        },
        resultingVersion,
      );
      await tx.execute(sql`insert into round_attendance_adjudications(round_id,segment_id,command_id,decision,effective_deadline,settled_horizon)
    values(${round.id},${target.id},${input.commandId},${resolution.decision},${resolution.effectiveDeadline}::timestamptz,${resolution.settledHorizon}::timestamptz)`);
      if (resolution.projection)
        await writeSpeakingProjection(tx, {
          roundId: round.id,
          projection: resolution.projection,
          resultingVersion,
          commandId: input.commandId,
        });
      await requireCurrentWeb(tx, input.instanceId);
      return resolution;
    });
  };
}

function requireResolutionProjection(resolution: AttendanceResolution): void {
  if (
    resolution.decision === 'forfeit' ||
    resolution.decision === 'abandoned'
  ) {
    if (!resolution.projection)
      throw createAppError(
        'INVARIANT',
        'Competitive attendance completion requires shared engine projection',
      );
  } else if (resolution.projection !== null)
    throw createAppError(
      'INVARIANT',
      'Noncompetitive attendance cannot mutate Round lifecycle',
    );
}
