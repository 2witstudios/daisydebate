import { createAppError } from '@daisy/errors';
import {
  principalAccessOf,
  type PrincipalAccess,
} from './participant-admission';
import {
  attendanceEnvelopeSchema,
  attendanceReceiptSchema,
  type AttendanceEnvelope,
  type AttendanceReceipt,
} from '@daisy/protocol/attendance';
import { idSchema } from '@daisy/protocol/primitives';
import { eq, sql } from 'drizzle-orm';
import { insertCommandRow } from './round-projection-writer';
import { roundCommands } from './schema/round-commands';
import {
  sampleRoundExecutionTime,
  type RoundTimeSource,
} from './round-execution-time';
import {
  attendanceSamples,
  closedAttendanceSegments,
  lockAttendanceAuthority,
  readAttendanceSeats,
  finalizedAttendanceSegments,
  principalColumns,
  type AttendanceFacts,
  type AttendanceTransaction,
  type AttendancePrincipal,
  type PrincipalColumns,
} from './attendance-facts';
export type {
  AttendanceTransaction,
  AttendancePrincipal,
  LockedAttendanceCheckIn,
} from './attendance-facts';
import {
  requireCommandInput,
  requireSameCommand,
} from './round-command-replay';
import { requireSameCheckIn } from './attendance-decisions';
import type { Tx } from './tx';
import { run as runStatement, query } from './raw-rows';
import { z } from 'zod';

type Scope = {
  readonly roundId: string;
  readonly principal: AttendancePrincipal;
};
type ReceiptInput = Scope & {
  readonly envelope: AttendanceEnvelope;
  readonly payloadDigest: string;
};
type Locked = Awaited<ReturnType<typeof lockAttendanceAuthority>>;
type Seats = Awaited<ReturnType<typeof readAttendanceSeats>>['seats'];
type WorkerVerifier = (
  tx: Tx,
  principal: Extract<AttendancePrincipal, { kind: 'agent' }>,
  roundId: string,
) => Promise<void>;
type CommonSession = {
  readonly authority: {
    readonly round: Locked['round'];
    readonly principalAccess: PrincipalAccess | null;
  };
  readonly readSeats: () => Promise<Seats>;
  readonly verifyWorker: () => Promise<void>;
  readonly readSamples: (
    from: string | null,
  ) => Promise<AttendanceFacts['samples']>;
};
export type AttendanceDiscoverySession = CommonSession & {
  readonly readAdjudicatedSegments: () => Promise<readonly string[]>;
  readonly readRecorded: (participantId: string) => Promise<{
    readonly receipts: readonly {
      readonly segmentId: string;
      readonly receivedAt: string;
    }[];
    readonly now: string;
  }>;
};
export type AttendanceReceiptSession = CommonSession & {
  readonly readClosedSegments: () => Promise<readonly string[]>;
  readonly replay: (participantId: string) => Promise<AttendanceReceipt | null>;
  readonly prepare: (
    participantId: string,
  ) => Promise<{ readonly receivedAt: string }>;
  readonly apply: () => Promise<void>;
};
type ReceiptState =
  | { readonly kind: 'open' }
  | {
      readonly kind: 'prepared';
      readonly receipt: AttendanceReceipt;
      readonly insert: boolean;
    }
  | { readonly kind: 'applying' }
  | { readonly kind: 'settled'; readonly receipt: AttendanceReceipt }
  | { readonly kind: 'closed' };

/** The app selects a seat; storage still binds it to this fenced cast and principal. */
function requireParticipant(
  locked: Locked,
  scope: Scope,
  participantId: string,
) {
  const seat = locked.round.participants.find(
    (row) => row.id === participantId,
  );
  const bound =
    scope.principal.kind === 'human'
      ? seat?.actorId === scope.principal.actorId
      : seat?.id === scope.principal.participantId;
  if (!seat || !bound) throw createAppError('CONFLICT');
}
function commonSession(
  tx: Tx,
  scope: Scope,
  locked: Locked,
  live: () => void,
  verify: WorkerVerifier,
): CommonSession {
  return {
    authority: {
      round: locked.round,
      principalAccess:
        scope.principal.kind === 'human'
          ? principalAccessOf(locked.accounts, scope.principal.actorId)
          : null,
    },
    readSeats: async () => {
      live();
      return (await readAttendanceSeats(tx, locked)).seats;
    },
    verifyWorker: async () => {
      live();
      if (scope.principal.kind !== 'agent') throw createAppError('CONFLICT');
      await verify(tx, scope.principal, scope.roundId);
    },
    readSamples: async (from) => {
      live();
      return attendanceSamples(tx, from);
    },
  };
}
async function readReplay(
  tx: Tx,
  input: ReceiptInput,
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
  requireSameCheckIn(receipt, {
    segmentId: input.envelope.segmentId,
    participantId,
  });
  return { ...receipt, replayed: true };
}

/** Family-local fenced reads and bound persistence; the application owns attendance choices. */
export function createAttendanceOperations(deps: {
  readonly run: AttendanceTransaction;
  readonly roundTime?: RoundTimeSource | undefined;
  readonly nextAttemptId: () => string;
  readonly verifyWorker: WorkerVerifier;
}) {
  return {
    async withAttendanceDiscovery<T>(
      input: Scope,
      work: (session: AttendanceDiscoverySession) => Promise<T>,
    ): Promise<T> {
      if (!idSchema.safeParse(input.roundId).success)
        throw createAppError('VALIDATION');
      return deps.run(async (tx) => {
        const locked = await lockAttendanceAuthority(
          tx,
          input.roundId,
          deps.nextAttemptId(),
          principalColumns(input.principal).actorId,
        );
        let active = true;
        const live = () => {
          if (!active) throw createAppError('CONFLICT');
        };
        try {
          return await work({
            ...commonSession(tx, input, locked, live, deps.verifyWorker),
            readAdjudicatedSegments: async () => {
              live();
              return finalizedAttendanceSegments(tx, input.roundId);
            },
            readRecorded: async (participantId) => {
              live();
              requireParticipant(locked, input, participantId);
              const rows = await query(
                tx,
                z.object({ segment_id: z.string(), received_at: z.string() }),
                sql`select segment_id,to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as received_at from round_check_ins where round_id=${input.roundId} and participant_id=${participantId} order by received_at,segment_id`,
              );
              return {
                receipts: rows.map((row) => ({
                  segmentId: row.segment_id,
                  receivedAt: row.received_at,
                })),
                now: await sampleRoundExecutionTime(tx, deps.roundTime),
              };
            },
          });
        } finally {
          active = false;
        }
      });
    },
    async withAttendanceReceipt(
      input: ReceiptInput,
      work: (session: AttendanceReceiptSession) => Promise<void>,
    ): Promise<AttendanceReceipt> {
      requireCommandInput(input, attendanceEnvelopeSchema);
      return deps.run(
        async (tx, first) => {
          const columns = principalColumns(input.principal);
          const locked = await lockAttendanceAuthority(
            tx,
            input.roundId,
            input.envelope.commandId,
            columns.actorId,
          );
          let state: ReceiptState = { kind: 'open' };
          const phase = () => state;
          const live = () => {
            if (phase().kind === 'closed') throw createAppError('CONFLICT');
          };
          const open = () => {
            if (phase().kind !== 'open') throw createAppError('CONFLICT');
          };
          try {
            await work({
              ...commonSession(tx, input, locked, live, deps.verifyWorker),
              readClosedSegments: async () => {
                live();
                return closedAttendanceSegments(tx, input.roundId);
              },
              replay: async (participantId) => {
                open();
                requireParticipant(locked, input, participantId);
                const receipt = await readReplay(
                  tx,
                  input,
                  columns,
                  participantId,
                );
                open();
                if (receipt) state = { kind: 'settled', receipt };
                return receipt;
              },
              prepare: async (participantId) => {
                open();
                requireParticipant(locked, input, participantId);
                const segmentId = input.envelope.segmentId;
                if (!locked.round.segments.some((row) => row.id === segmentId))
                  throw createAppError('CONFLICT');
                const rows = await query(
                  tx,
                  z.object({ received_at: z.string() }),
                  sql`select to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as received_at from round_check_ins where round_id=${input.roundId} and segment_id=${segmentId} and participant_id=${participantId}`,
                );
                open();
                const receipt: AttendanceReceipt = {
                  version: 1,
                  commandId: input.envelope.commandId,
                  roundId: input.roundId,
                  segmentId,
                  participantId,
                  receivedAt: rows[0]?.received_at ?? first.receivedAt,
                  resultingVersion: locked.current.version,
                  replayed: rows.length > 0,
                };
                state = {
                  kind: 'prepared',
                  receipt,
                  insert: rows.length === 0,
                };
                return { receivedAt: receipt.receivedAt };
              },
              apply: async () => {
                const prepared = phase();
                if (prepared.kind !== 'prepared')
                  throw createAppError('CONFLICT');
                state = { kind: 'applying' };
                const { receipt } = prepared;
                await insertCommandRow(
                  tx,
                  input.roundId,
                  {
                    commandId: input.envelope.commandId,
                    ...columns,
                    type: 'check_in',
                    payloadDigest: input.payloadDigest,
                    result: { ...receipt },
                  },
                  locked.current.version,
                );
                if (prepared.insert)
                  await runStatement(
                    tx,
                    sql`insert into round_check_ins(command_id,round_id,segment_id,participant_id,received_at) values(${receipt.commandId},${receipt.roundId},${receipt.segmentId},${receipt.participantId},${receipt.receivedAt}::timestamptz)`,
                  );
                state = { kind: 'settled', receipt };
              },
            });
            const settled = phase();
            if (settled.kind !== 'settled') throw createAppError('CONFLICT');
            return settled.receipt;
          } finally {
            state = { kind: 'closed' };
          }
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
