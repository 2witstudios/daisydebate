import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';
import {
  factReleasedSql,
  roundAliasR,
  type SpectatorClock,
} from './spectator-release-sql';

const rowsOf = async <T>(
  tx: Pick<BunSQLDatabase, 'execute'>,
  query: ReturnType<typeof sql>,
) => (await tx.execute(query)) as unknown as T[];

/**
 * What an account has watched (SPECT-1.4). It lists a Round's resolution only
 * once the timeline has released it, so history is never a way to read ahead.
 */
export const watchHistoryOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** Keeps the newest visit. A Round with no audience writes nothing. */
  recordWatched(input: {
    readonly userId: string;
    readonly roundId: string;
    readonly at: string;
  }) {
    return instrumented(eventSink, 'recordWatched', async () => {
      await database.execute(sql`insert into watch_history(user_id,round_id,watched_at)
        select u.id,r.id,${input.at}::timestamptz
        from users u join rounds r on r.id=${input.roundId}
          and r.visibility in ('public','unlisted') and r.room_id is not null
        where u.id=${input.userId} and u.deleted_at is null
        on conflict (user_id,round_id) do update
          set watched_at=greatest(watch_history.watched_at,excluded.watched_at)`);
    });
  },
  forgetWatched(input: { readonly userId: string; readonly roundId: string }) {
    return instrumented(eventSink, 'forgetWatched', async () => {
      await database.execute(sql`delete from watch_history
        where user_id=${input.userId} and round_id=${input.roundId}`);
    });
  },
  clearWatchHistory(input: { readonly userId: string }) {
    return instrumented(eventSink, 'clearWatchHistory', async () => {
      await database.execute(
        sql`delete from watch_history where user_id=${input.userId}`,
      );
    });
  },
  listWatchHistory(input: {
    readonly userId: string;
    readonly clock: SpectatorClock;
    readonly limit: number;
  }) {
    return instrumented(eventSink, 'listWatchHistory', async () =>
      rowsOf<{
        roundId: string;
        resolution: string | null;
        watchedAt: string;
      }>(
        database,
        sql`select r.id as "roundId",
            case when ${factReleasedSql(sql`r.started_at`, roundAliasR, input.clock)} then r.resolution end as resolution,
            to_char(h.watched_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "watchedAt"
          from watch_history h join rounds r on r.id=h.round_id
          where h.user_id=${input.userId} and r.visibility in ('public','unlisted')
          order by h.watched_at desc,r.id limit ${input.limit}`,
      ),
    );
  },
  /** The retention sweep: history goes a year after the last visit. */
  purgeExpiredWatchHistory(input: {
    readonly before: string;
    readonly limit: number;
  }) {
    return instrumented(eventSink, 'purgeExpiredWatchHistory', async () => {
      const gone = await rowsOf(
        database,
        sql`delete from watch_history where (user_id,round_id) in (
            select user_id,round_id from watch_history
            where watched_at < ${input.before}::timestamptz limit ${input.limit})
          returning user_id`,
      );
      return gone.length;
    });
  },
});

export const watchHistoryPrivacyAdopter: PrivacyAdopter = {
  id: 'watch-history',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await tx.execute(
      sql`delete from watch_history where user_id=${subject.userId}`,
    );
  },
  export: async (tx, subject) => ({
    watch_history: exportRows(
      await rowsOf<Record<string, unknown>>(
        tx,
        sql`select round_id,watched_at from watch_history
          where user_id=${subject.userId} order by watched_at,round_id`,
      ),
    ),
  }),
};
