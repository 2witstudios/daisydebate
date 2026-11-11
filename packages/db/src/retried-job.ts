import { sql, type SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { rowsOf } from './raw-rows';
import type { retriedJobColumns } from './schema/columns';

type Execute = Pick<BunSQLDatabase, 'execute'>;
type RetriedJobTable = PgTable &
  Record<keyof ReturnType<typeof retriedJobColumns>, PgColumn>;

/**
 * The one writer of a retried job's outcome, for any table built from
 * `retriedJobColumns`. A runner read `attempts` before it tried, so its try is
 * attempt `read + 1`: runners that read the same count made the same attempt,
 * and it is counted once. Each answers whether its write landed.
 */
export const retriedJob = (table: RetriedJobTable) => ({
  /** The attempt failed: counted and backed off, unless another runner already did. */
  failed: async (
    database: Execute,
    job: SQL,
    input: { readonly read: number; readonly retryAt: string },
  ): Promise<boolean> =>
    (
      await rowsOf(
        database,
        sql`update ${table} set attempts = ${input.read + 1}, retry_at = ${input.retryAt}::timestamptz
          where (${job}) and status = 'pending' and attempts = ${input.read} returning 1`,
      )
    ).length === 1,
  /** The attempt succeeded: recorded whatever a concurrent failure counted. */
  succeeded: async (
    database: Execute,
    job: SQL,
    input: { readonly read: number; readonly now: string },
  ): Promise<boolean> =>
    (
      await rowsOf(
        database,
        sql`update ${table} set status = 'succeeded', attempts = greatest(attempts, ${input.read + 1}),
            succeeded_at = ${input.now}::timestamptz
          where (${job}) and status = 'pending' returning 1`,
      )
    ).length === 1,
});
