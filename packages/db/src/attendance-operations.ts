import { createAppError } from '@daisy/errors';
import {
  attendanceEnvelopeSchema,
  attendanceReceiptSchema,
  idSchema,
  type AttendanceEnvelope,
  type AttendanceReceipt,
} from '@daisy/protocol';
import { and, eq, sql } from 'drizzle-orm';
import { insertCommandRow } from './round-projection-writer';
import { roundCommands } from './schema/round-commands';
import { agentRuns } from './schema/agent-runs';
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
async function requireActiveAgent(
  tx: AttendanceTransactionContext,
  principal: Extract<AttendancePrincipal, { kind: 'agent' }>,
  seat: Fenced['seats'][number],
): Promise<void> {
  if (
    seat.kind !== 'bot' ||
    principal.serviceId !== `agent-run:${principal.agentRunId}`
  )
    throw createAppError('AUTHORIZATION');
  const [run] = await tx
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.id, principal.agentRunId),
        eq(agentRuns.roundParticipantId, seat.id),
      ),
    )
    .for('share');
  if (
    !run ||
    run.endedAt !== null ||
    !['speech', 'cross_ex'].includes(run.kind)
  )
    throw createAppError('AUTHORIZATION');
}
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
    await requireActiveAgent(tx, principal, seat);
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
  if (
    previous.roundId !== input.roundId ||
    previous.actorId !== columns.actorId ||
    previous.serviceId !== columns.serviceId ||
    previous.type !== 'check_in' ||
    previous.payloadDigest !== input.payloadDigest
  )
    throw createAppError('CONFLICT', 'command-conflict');
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
    async recordRoundCheckIn(input: CheckInInput): Promise<AttendanceReceipt> {
      if (
        !idSchema.safeParse(input.roundId).success ||
        !attendanceEnvelopeSchema.safeParse(input.envelope).success ||
        !/^[0-9a-f]{64}$/.test(input.payloadDigest)
      )
        throw createAppError('VALIDATION');
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
            eligibleParticipantIds: seats
              .filter((seat) => seat.eligible && seat.role !== 'judge')
              .map((seat) => seat.id),
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
