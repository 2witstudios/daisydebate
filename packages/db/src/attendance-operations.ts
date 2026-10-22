import { createAppError } from '@daisy/errors';
import {
  attendanceEnvelopeSchema,
  attendanceReceiptSchema,
  idSchema,
  type AttendanceEnvelope,
  type AttendanceReceipt,
} from '@daisy/protocol';
import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { lockAuthorizationActors } from './authorization';
import { actorFact } from './room-command-facts';
import { hydrateRoundRows, type RoundHydration } from './round-hydration';
import {
  lockedRoundVersion,
  insertCommandRow,
} from './round-projection-writer';
import { roundParticipants } from './schema/round-participants';
import { roundCommands } from './schema/round-commands';
import { agentRuns } from './schema/agent-runs';
import type { AvailabilityEvidence } from './availability-operations';

export type AttendanceTransactionContext = Pick<
  BunSQLDatabase,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;
/** The bounded same-pool producer supplies its FIRST writer identity statement's timestamp. */
export type AttendanceTransaction = <T>(
  run: (
    tx: AttendanceTransactionContext,
    receipt: { readonly receivedAt: string },
  ) => Promise<T>,
) => Promise<T>;
export type AttendancePrincipal =
  | { readonly kind: 'human'; readonly actorId: string }
  | {
      readonly kind: 'agent';
      readonly serviceId: string;
      readonly agentRunId: string;
      readonly participantId: string;
      readonly publicationEpoch: number;
    };
export type AttendanceFacts = {
  readonly round: RoundHydration;
  readonly eligibleParticipantIds: readonly string[];
  readonly samples: readonly AvailabilityEvidence[];
  readonly finalizedSegmentIds: readonly string[];
};
export type LockedAttendanceCheckIn = AttendanceFacts & {
  readonly participantId: string;
  readonly receivedAt: string;
};

type PrincipalColumns = {
  readonly actorId: string | null;
  readonly serviceId: string | null;
};
const principalColumns = (principal: AttendancePrincipal): PrincipalColumns =>
  principal.kind === 'human'
    ? { actorId: principal.actorId, serviceId: null }
    : { actorId: null, serviceId: principal.serviceId };

export async function fenceAttendance(
  tx: AttendanceTransactionContext,
  roundId: string,
  commandId: string,
  principalActorId: string | null,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${commandId},59002))`,
  );
  const initial = await tx
    .select({ actorId: roundParticipants.actorId })
    .from(roundParticipants)
    .where(eq(roundParticipants.roundId, roundId));
  const actorIds = [
    ...new Set([
      ...initial.map((seat) => seat.actorId),
      ...(principalActorId ? [principalActorId] : []),
    ]),
  ];
  const accounts = actorIds.length
    ? await lockAuthorizationActors(tx, actorIds, {
        maxActors: actorIds.length,
      })
    : [];
  const current = await lockedRoundVersion(tx, roundId);
  const round = await hydrateRoundRows(tx, roundId);
  if (!round) throw createAppError('NOT_FOUND');
  if (round.status !== 'active')
    throw createAppError('CONFLICT', 'attendance-terminal');
  if (round.participants.some((seat) => !actorIds.includes(seat.actorId)))
    throw createAppError('CONFLICT');
  const seats = await Promise.all(
    round.participants.map(async (seat) => {
      const actor = await actorFact(tx, seat.actorId);
      const account = accounts.find(
        (account) => account?.actorId === seat.actorId,
      );
      return {
        ...seat,
        kind: actor?.kind,
        eligible:
          actor?.kind === 'bot'
            ? actor.eligible
            : account?.member === true && !account.erased,
      };
    }),
  );
  return { current, round, seats };
}
export async function attendanceEvidence(
  tx: AttendanceTransactionContext,
  round: RoundHydration,
): Promise<Pick<AttendanceFacts, 'samples' | 'finalizedSegmentIds'>> {
  const from = round.segments[0]?.startedAt ?? round.startedAt;
  const samples = from
    ? await tx.execute(
        sql`select at,healthy,cause from availability_samples where at >= ${from}::timestamptz or at=(select max(at) from availability_samples where at < ${from}::timestamptz) order by at`,
      )
    : [];
  const resolved = await tx.execute(
    sql`select segment_id from round_attendance_adjudications where round_id=${round.id}`,
  );
  return {
    samples: (
      samples as unknown as {
        at: Date;
        healthy: boolean;
        cause: AvailabilityEvidence['cause'];
      }[]
    ).map((row) => ({
      at: row.at.toISOString(),
      healthy: row.healthy,
      cause: row.cause,
    })),
    finalizedSegmentIds: (resolved as unknown as { segment_id: string }[]).map(
      (row) => row.segment_id,
    ),
  };
}

/** Attendance stores facts only; competitive decisions/projections remain pure caller-owned engine work. */
export function createAttendanceOperations(deps: {
  readonly transaction: AttendanceTransaction;
  readonly verifyWorker: (
    tx: AttendanceTransactionContext,
    principal: Extract<AttendancePrincipal, { kind: 'agent' }>,
    roundId: string,
  ) => Promise<void>;
}) {
  return {
    async recordRoundCheckIn(input: {
      readonly roundId: string;
      readonly envelope: AttendanceEnvelope;
      readonly principal: AttendancePrincipal;
      readonly payloadDigest: string;
      readonly acceptWindow: (facts: LockedAttendanceCheckIn) => void;
    }): Promise<AttendanceReceipt> {
      if (
        !idSchema.safeParse(input.roundId).success ||
        !attendanceEnvelopeSchema.safeParse(input.envelope).success ||
        !/^[0-9a-f]{64}$/.test(input.payloadDigest)
      )
        throw createAppError('VALIDATION');
      return deps.transaction(async (tx, first) => {
        const columns = principalColumns(input.principal);
        const { current, round, seats } = await fenceAttendance(
          tx,
          input.roundId,
          input.envelope.commandId,
          columns.actorId,
        );
        const seat = seats.find((seat) =>
          input.principal.kind === 'human'
            ? seat.actorId === input.principal.actorId
            : seat.id === input.principal.participantId,
        );
        if (
          !seat?.eligible ||
          seat.role === 'judge' ||
          (input.principal.kind === 'human' && seat.kind !== 'human')
        )
          throw createAppError('AUTHORIZATION');
        if (input.principal.kind === 'agent') {
          if (
            seat.kind !== 'bot' ||
            input.principal.serviceId !==
              `agent-run:${input.principal.agentRunId}`
          )
            throw createAppError('AUTHORIZATION');
          const [run] = await tx
            .select()
            .from(agentRuns)
            .where(
              and(
                eq(agentRuns.id, input.principal.agentRunId),
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
          await deps.verifyWorker(tx, input.principal, round.id);
        }
        const segment = round.segments.find(
          (segment) => segment.id === input.envelope.segmentId,
        );
        if (!segment || segment.type !== 'speech')
          throw createAppError('CONFLICT', 'attendance-segment');
        const evidence = await attendanceEvidence(tx, round);
        if (evidence.finalizedSegmentIds.includes(segment.id))
          throw createAppError('CONFLICT', 'attendance-finalized');
        const [previous] = await tx
          .select()
          .from(roundCommands)
          .where(eq(roundCommands.commandId, input.envelope.commandId));
        if (previous) {
          if (
            previous.roundId !== round.id ||
            previous.actorId !== columns.actorId ||
            previous.serviceId !== columns.serviceId ||
            previous.type !== 'check_in' ||
            previous.payloadDigest !== input.payloadDigest
          )
            throw createAppError('CONFLICT', 'command-conflict');
          const receipt = attendanceReceiptSchema.parse(previous.result);
          if (
            receipt.segmentId !== segment.id ||
            receipt.participantId !== seat.id
          )
            throw createAppError('CONFLICT', 'command-conflict');
          input.acceptWindow({
            round,
            ...evidence,
            eligibleParticipantIds: seats
              .filter((seat) => seat.eligible && seat.role !== 'judge')
              .map((seat) => seat.id),
            participantId: seat.id,
            receivedAt: receipt.receivedAt,
          });
          return { ...receipt, replayed: true };
        }
        const existing = await tx.execute(
          sql`select to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as received_at from round_check_ins where round_id=${round.id} and segment_id=${segment.id} and participant_id=${seat.id}`,
        );
        const stamp =
          (existing as unknown as { received_at: string }[])[0]?.received_at ??
          first.receivedAt;
        input.acceptWindow({
          round,
          ...evidence,
          eligibleParticipantIds: seats
            .filter((seat) => seat.eligible && seat.role !== 'judge')
            .map((seat) => seat.id),
          participantId: seat.id,
          receivedAt: stamp,
        });
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
      });
    },
  };
}
