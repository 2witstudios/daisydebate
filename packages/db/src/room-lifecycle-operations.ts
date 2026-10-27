import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type {
  ActiveRoomFacts,
  RoomAssemblyState,
  RoomMutationOutcome,
} from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { AUTOMATIC_STRIKE_DELAY_MS } from '@daisy/protocol/resolution-draw';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { rooms } from './schema/rooms';
import {
  roomResolutionDraws,
  roomResolutionStrikes,
} from './schema/resolution-draws';
import { activeRoomFacts } from './room-membership-persistence';
import { persistRoomMutation } from './room-mutation-persistence';
import type { roomCommandTransaction } from './room-command-transaction';
import {
  type Account,
  type Caller,
  appendRoomChanged,
  requireAccount,
  roomFacts,
  transactionNow,
} from './room-command-facts';

type Maintain = (
  state: RoomAssemblyState,
  facts: {
    readonly lastCommandAt: string;
    readonly now: string;
    readonly drawSeed: string | null;
  },
) => Extract<RoomMutationOutcome, { ok: true }> | null;

/** Active-room reads and idle expiry (ADR 0070); the engine decides, this adapter persists. */
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
   * Open Rooms that need maintenance by database time: a draw whose next
   * strike is due, or, with an idle timeout, a last
   * accepted command and any running prep at least that old. A
   * conservative prefilter: the engine decides under the Room lock.
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
    // The last strike's instant covers the reveal, which the engine counts too.
    const lastStrike = sql`(select max(s.struck_at) from ${roomResolutionStrikes} s join ${roomResolutionDraws} d on d.id = s.draw_id where d.room_id = ${rooms.id})`;
    const lastActivity = sql`greatest(${rooms.lastCommandAt}, coalesce(${rooms.prepStartedAt} + ${rooms.prepRemainingMs} * interval '1 millisecond', ${rooms.lastCommandAt}), coalesce(${lastStrike}, ${rooms.lastCommandAt}))`;
    // The engine's turnOf in SQL: the next strike falls due when its turn
    // opens (the draw's start, or the last strike) plus the side's window,
    // AUTOMATIC_STRIKE_DELAY_MS for an all-bot side. Only those draws need a pulse.
    const turnSide = sql`case when st.n % 2 = 0 then d.manifest->>'firstStriker' when d.manifest->>'firstStriker' = 'affirmative' then 'negative' else 'affirmative' end`;
    const turnWindowMs = sql`case when d.manifest->'controllers'->>(${turnSide}) = 'automatic' then ${AUTOMATIC_STRIKE_DELAY_MS} else (d.manifest->>'strikeWindowMs')::int end`;
    const dueDraw = sql`exists (select 1 from ${roomResolutionDraws} d cross join lateral (select count(*)::int as n, max(s.struck_at) as last from ${roomResolutionStrikes} s where s.draw_id = d.id) st where d.room_id = ${rooms.id} and st.n < d.draw_size - 1 and coalesce(st.last, d.started_at) + ${turnWindowMs} * interval '1 millisecond' <= statement_timestamp())`;
    const idle =
      input.idleTimeoutMs === null
        ? sql`false`
        : sql`${lastActivity} <= statement_timestamp() - ${input.idleTimeoutMs} * interval '1 millisecond'`;
    return instrumented(eventSink, 'readMaintenanceCandidates', async () =>
      (
        await database
          .select({ id: rooms.id })
          .from(rooms)
          .where(
            and(
              inArray(rooms.status, ['assembling', 'ready']),
              sql`(${dueDraw} or ${idle})`,
            ),
          )
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
        const { state, drawSeed } = await roomFacts(tx, row);
        const outcome = input.maintain(state, {
          lastCommandAt: row.lastCommandAt.toISOString(),
          now,
          drawSeed,
        });
        if (!outcome) return false;
        await persistRoomMutation(
          tx,
          outcome.mutation,
          '',
          now,
          false,
          state.resolutionDraw?.strikes.length ?? 0,
        );
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
