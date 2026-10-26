import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type {
  ActiveRoomFacts,
  RoomAssemblyState,
  RoomMutationOutcome,
} from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { rooms } from './schema/rooms';
import { activeRoomFacts } from './room-membership-persistence';
import { persistRoomMutation } from './room-mutation-persistence';
import type { roomCommandTransaction } from './room-command-transaction';
import {
  type Account,
  type Caller,
  appendRoomChanged,
  requireAccount,
  roomState,
  transactionNow,
} from './room-command-facts';

type Expire = (
  state: RoomAssemblyState,
  facts: { readonly lastCommandAt: string; readonly now: string },
) => Extract<RoomMutationOutcome, { ok: true }> | null;

/** Active-room reads and idle expiry (ADR 0069); the engine decides, this adapter persists. */
export const roomLifecycleOperations = ({
  database,
  eventSink,
  commandTransaction,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
  readonly commandTransaction: ReturnType<typeof roomCommandTransaction>;
}) => ({
  /** The caller's own active Room facts, or null when no Room holds them. */
  readActiveRoomFacts(
    caller: Caller,
    authorize: (account: Account) => boolean,
  ): Promise<ActiveRoomFacts | null> {
    return instrumented(eventSink, 'readActiveRoomFacts', () =>
      database.transaction(async (tx) => {
        await requireAccount(tx, caller, authorize);
        return activeRoomFacts(tx, caller.actorId);
      }),
    );
  },
  /**
   * Open Rooms whose last command, and any running prep, are at least
   * `idleTimeoutMs` old by database time. A prefilter only: each expiry
   * rechecks the engine rule under the Room lock.
   */
  readIdleRoomCandidates(input: {
    readonly idleTimeoutMs: number;
    readonly limit: number;
  }): Promise<readonly string[]> {
    if (
      !Number.isSafeInteger(input.idleTimeoutMs) ||
      input.idleTimeoutMs < 1 ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1
    )
      throw createAppError('VALIDATION');
    const lastActivity = sql`greatest(${rooms.updatedAt}, coalesce(${rooms.prepStartedAt} + ${rooms.prepRemainingMs} * interval '1 millisecond', ${rooms.updatedAt}))`;
    return instrumented(eventSink, 'readIdleRoomCandidates', async () =>
      (
        await database
          .select({ id: rooms.id })
          .from(rooms)
          .where(
            and(
              inArray(rooms.status, ['assembling', 'ready']),
              sql`${lastActivity} <= statement_timestamp() - ${input.idleTimeoutMs} * interval '1 millisecond'`,
            ),
          )
          .orderBy(asc(rooms.updatedAt))
          .limit(input.limit)
      ).map((row) => row.id),
    );
  },
  /** Closes one idle Room if the engine still finds it idle; a busy Room is skipped. */
  expireIdleRoom(input: {
    readonly roomId: string;
    readonly expire: Expire;
  }): Promise<boolean> {
    return instrumented(eventSink, 'expireIdleRoom', () =>
      commandTransaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.id, input.roomId))
          .for('update', { skipLocked: true });
        if (!row) return false;
        const now = await transactionNow(tx);
        const outcome = input.expire(await roomState(tx, row), {
          lastCommandAt: row.updatedAt.toISOString(),
          now,
        });
        if (!outcome) return false;
        await persistRoomMutation(tx, outcome.mutation, '', now);
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
