import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { parsedColumn } from './raw-rows';
import { openRoomStatuses } from '@daisy/protocol/room-contract';
import { z } from 'zod';
import { maxHostedRooms, type HostedRoom } from '@daisy/protocol/hosted-rooms';
import { type ActiveRoomFacts } from '@daisy/protocol/active-room';
import {
  type RoomAssemblyState,
  type RoomMutationOutcome,
} from '@daisy/protocol/room-contract';
import { createAppError } from '@daisy/errors';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { roomParticipants, rooms } from './schema/rooms';
import { activeRoomFacts } from './room-membership-persistence';
import { persistRoomMutation } from './room-mutation-persistence';
import type { roomCommandTransaction } from './room-command-transaction';
import {
  type Account,
  type Caller,
  appendRoomChanged,
  requireAccount,
  roomFactsForWrite,
  transactionNow,
} from './room-command-facts';
import { roomIsOpen } from './room-open';
import { inTransaction, type TxSource } from './tx';

type Maintain = (
  state: RoomAssemblyState,
  facts: {
    readonly lastCommandAt: string;
    readonly now: string;
  },
) => Extract<RoomMutationOutcome, { ok: true }> | null;

/** Active-room reads and idle expiry (ADR 0070); the engine decides, this adapter persists. */
export const roomLifecycleOperations = ({
  database,
  eventSink,
  commandTransaction,
}: {
  readonly database: TxSource;
  readonly eventSink?: DatabaseEventSink | undefined;
  readonly commandTransaction: ReturnType<typeof roomCommandTransaction>;
}) => ({
  /** The caller's own active Room facts, or null when no Room holds them. */
  readActiveRoomFacts(
    caller: Caller,
    authorize: (account: Account) => boolean,
  ): Promise<ActiveRoomFacts | null> {
    return instrumented(eventSink, 'readActiveRoomFacts', () =>
      inTransaction(database, async (tx) => {
        await requireAccount(tx, caller, authorize);
        return activeRoomFacts(tx, caller.actorId);
      }),
    );
  },
  /**
   * The open Rooms the caller hosts, newest first (TAB-6.16), and whether
   * they also sit in each. Hosting holds no seat, so a host without one has
   * no active Room; this is the read that leads them back.
   */
  listHostedRooms(
    caller: Caller,
    authorize: (account: Account) => boolean,
  ): Promise<readonly HostedRoom[]> {
    return instrumented(eventSink, 'listHostedRooms', () =>
      inTransaction(database, async (tx) => {
        await requireAccount(tx, caller, authorize);
        return tx
          .select({
            id: rooms.id,
            title: rooms.title,
            status: parsedColumn(
              z.enum(openRoomStatuses),
              sql`${rooms.status}`,
            ),
            seated: parsedColumn(
              z.boolean(),
              sql`exists (select 1 from ${roomParticipants} where ${roomParticipants.roomId} = ${rooms.id} and ${roomParticipants.actorId} = ${caller.actorId})`,
            ),
          })
          .from(rooms)
          .where(and(eq(rooms.hostActorId, caller.actorId), roomIsOpen()))
          .orderBy(desc(rooms.createdAt), desc(rooms.id))
          .limit(maxHostedRooms);
      }),
    );
  },
  /**
   * Open Rooms that need maintenance by database time: with an idle timeout,
   * a last accepted command at least that old. A conservative prefilter: the
   * engine decides under the Room lock.
   */
  readMaintenanceCandidates(input: {
    readonly idleTimeoutMs: number | null;
    readonly limit: number;
  }): Promise<readonly string[]> {
    if (
      (input.idleTimeoutMs !== null &&
        (!Number.isSafeInteger(input.idleTimeoutMs) ||
          input.idleTimeoutMs < 1)) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1
    )
      throw createAppError('VALIDATION');
    const idle =
      input.idleTimeoutMs === null
        ? sql`false`
        : sql`${rooms.lastCommandAt} <= statement_timestamp() - ${input.idleTimeoutMs} * interval '1 millisecond'`;
    return instrumented(eventSink, 'readMaintenanceCandidates', async () =>
      (
        await database
          .select({ id: rooms.id })
          .from(rooms)
          .where(and(roomIsOpen(), idle))
          .orderBy(asc(rooms.lastCommandAt))
          .limit(input.limit)
      ).map((row) => row.id),
    );
  },
  /**
   * One locked maintenance step: the engine settles due strikes, then
   * decides expiry; a Room another writer holds is skipped.
   */
  maintainRoom(input: {
    readonly roomId: string;
    readonly maintain: Maintain;
  }): Promise<boolean> {
    return instrumented(eventSink, 'maintainRoom', () =>
      commandTransaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.id, input.roomId))
          .for('update', { skipLocked: true });
        if (!row) return false;
        const now = await transactionNow(tx);
        const { state } = await roomFactsForWrite(tx, row);
        const outcome = input.maintain(state, {
          lastCommandAt: row.lastCommandAt.toISOString(),
          now,
        });
        if (!outcome) return false;
        await persistRoomMutation(tx, outcome.mutation, now, false);
        await appendRoomChanged(
          tx,
          input.roomId,
          outcome.mutation.state.changeVersion,
        );
        return true;
      }),
    );
  },
});
