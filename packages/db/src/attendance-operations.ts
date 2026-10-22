import { createAppError } from '@daisy/errors';
import {
  attendanceEnvelopeSchema,
  attendanceReceiptSchema,
  idSchema,
  type AttendanceEnvelope,
  type AttendanceReceipt,
} from '@daisy/protocol';
import { eq, sql } from 'drizzle-orm';
import { insertCommandRow } from './round-projection-writer';
import { roundCommands } from './schema/round-commands';
import { sampleRoundExecutionTime } from './round-execution-time';
import {
  attendanceEvidence,
  fenceAttendance,
  principalColumns,
  type AttendanceTransactionContext,
  type AttendanceTransaction,
  type AttendancePrincipal,
  type LockedAttendanceCheckIn,
  type PrincipalColumns,
} from './attendance-facts';
export type {
  AttendanceTransactionContext,
  AttendanceTransaction,
  AttendancePrincipal,
  AttendanceFacts,
  LockedAttendanceCheckIn,
} from './attendance-facts';
import {
  requireCommandInput,
  requireSameCommand,
} from './round-command-replay';
import { eligibleCompetitorIds } from './seat-eligibility';

type WorkerVerifier = (
  tx: AttendanceTransactionContext,
  principal: Extract<AttendancePrincipal, { kind: 'agent' }>,
  roundId: string,
) => Promise<void>;
type CheckInInput = {
  readonly roundId: string;
  readonly envelope: AttendanceEnvelope;
  readonly principal: AttendancePrincipal;
  readonly payloadDigest: string;
  readonly acceptWindow: (facts: LockedAttendanceCheckIn) => void;
};
type Fenced = Awaited<ReturnType<typeof fenceAttendance>>;
async function authorizeSeat(
  tx: AttendanceTransactionContext,
  principal: AttendancePrincipal,
  fenced: Fenced,
  verifyWorker: WorkerVerifier,
) {
  const seat = fenced.seats.find((seat) =>
    principal.kind === 'human'
      ? seat.actorId === principal.actorId
      : seat.id === principal.participantId,
  );
  if (!seat?.eligible || seat.role === 'judge')
    throw createAppError('AUTHORIZATION');
  if (principal.kind === 'human') {
    if (seat.kind !== 'human') throw createAppError('AUTHORIZATION');
  } else {
    if (
      seat.kind !== 'bot' ||
      principal.serviceId !== `agent-run:${principal.agentRunId}`
    )
      throw createAppError('AUTHORIZATION');
    // The required canonical verifier SHARE-locks the exact seat/run and
    // checks active kind, config, epoch and lease in this same transaction.
    await verifyWorker(tx, principal, fenced.round.id);
  }
  return seat;
}
async function readReplay(
  tx: AttendanceTransactionContext,
  input: CheckInInput,
  columns: PrincipalColumns,
  participantId: string,
): Promise<AttendanceReceipt | null> {
  const [previous] = await tx
    .select()
    .from(roundCommands)
    .where(eq(roundCommands.commandId, input.envelope.commandId));
  if (!previous) return null;
  requireSameCommand(previous, {
    ...columns,
    roundId: input.roundId,
    payloadDigest: input.payloadDigest,
    type: 'check_in',
  });
  const receipt = attendanceReceiptSchema.parse(previous.result);
  if (
    receipt.segmentId !== input.envelope.segmentId ||
    receipt.participantId !== participantId
  )
    throw createAppError('CONFLICT', 'command-conflict');
  return { ...receipt, replayed: true };
}
/** Attendance stores facts only; competitive decisions/projections remain pure engine work. */
export function createAttendanceOperations(deps: {
  readonly transaction: AttendanceTransaction;
  readonly nextAttemptId: () => string;
  readonly verifyWorker: WorkerVerifier;
}) {
  return {
    /** Fresh scoped controller/human authority; timing hints never manufacture a receipt. */
    async readRoundAttendanceTargets(input: {
      readonly roundId: string;
      readonly principal: AttendancePrincipal;
    }) {
      if (!idSchema.safeParse(input.roundId).success)
        throw createAppError('VALIDATION');
      return deps.transaction(async (tx) => {
        const columns = principalColumns(input.principal);
        const fenced = await fenceAttendance(
          tx,
          input.roundId,
          deps.nextAttemptId(),
          columns.actorId,
        );
        const seat = await authorizeSeat(
          tx,
          input.principal,
          fenced,
          deps.verifyWorker,
        );
        const evidence = await attendanceEvidence(tx, fenced.round);
        const recorded = await tx.execute(
          sql`select segment_id,to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as received_at from round_check_ins where round_id=${input.roundId} and participant_id=${seat.id} order by received_at,segment_id`,
        );
        return {
          round: fenced.round,
          ...evidence,
          participantId: seat.id,
          eligibleParticipantIds: eligibleCompetitorIds(fenced.seats),
          receipts: (
            recorded as unknown as { segment_id: string; received_at: string }[]
          ).map((row) => ({
            segmentId: row.segment_id,
            receivedAt: row.received_at,
          })),
          now: await sampleRoundExecutionTime(tx),
        };
      });
    },
    async recordRoundCheckIn(input: CheckInInput): Promise<AttendanceReceipt> {
      requireCommandInput(input, attendanceEnvelopeSchema);
      return deps.transaction(
        async (tx, first) => {
          const columns = principalColumns(input.principal);
          const fenced = await fenceAttendance(
            tx,
            input.roundId,
            input.envelope.commandId,
            columns.actorId,
          );
          const { round, current, seats } = fenced;
          const seat = await authorizeSeat(
            tx,
            input.principal,
            fenced,
            deps.verifyWorker,
          );
          const segment = round.segments.find(
            (segment) => segment.id === input.envelope.segmentId,
          );
          if (!segment || segment.type !== 'speech')
            throw createAppError('CONFLICT', 'attendance-segment');
          const evidence = await attendanceEvidence(tx, round);
          if (evidence.finalizedSegmentIds.includes(segment.id))
            throw createAppError('CONFLICT', 'attendance-finalized');
          const facts = {
            round,
            ...evidence,
            eligibleParticipantIds: eligibleCompetitorIds(seats),
            participantId: seat.id,
          };
          const replay = await readReplay(tx, input, columns, seat.id);
          if (replay) {
            input.acceptWindow({ ...facts, receivedAt: replay.receivedAt });
            return replay;
          }
          const existing = await tx.execute(
            sql`select to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as received_at from round_check_ins where round_id=${round.id} and segment_id=${segment.id} and participant_id=${seat.id}`,
          );
          const stamp =
            (existing as unknown as { received_at: string }[])[0]
              ?.received_at ?? first.receivedAt;
          input.acceptWindow({ ...facts, receivedAt: stamp });
          const receipt: AttendanceReceipt = {
            version: 1,
            commandId: input.envelope.commandId,
            roundId: round.id,
            segmentId: segment.id,
            participantId: seat.id,
            receivedAt: stamp,
            resultingVersion: current.version,
            replayed: existing.length > 0,
          };
          await insertCommandRow(
            tx,
            round.id,
            {
              commandId: input.envelope.commandId,
              ...columns,
              type: 'check_in',
              payloadDigest: input.payloadDigest,
              result: { ...receipt },
            },
            current.version,
          );
          if (existing.length === 0)
            await tx.execute(
              sql`insert into round_check_ins(command_id,round_id,segment_id,participant_id,received_at) values(${input.envelope.commandId},${round.id},${segment.id},${seat.id},${stamp}::timestamptz)`,
            );
          return receipt;
        },
        {
          attemptId: deps.nextAttemptId(),
          commandId: input.envelope.commandId,
          roundId: input.roundId,
          payloadDigest: input.payloadDigest,
          ...principalColumns(input.principal),
        },
      );
    },
  };
}
