import { createAppError } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { readFlagSnapshot } from './flags-read';
import { runFlagCommand, type FlagCommandInput } from './flags-command';
import { lockFlags } from './flags-lock';
import { inTransaction, type TxSource } from './tx';
import { query } from './raw-rows';
import { z } from 'zod';

export function flagOperations({
  database,
  eventSink,
}: {
  readonly database: TxSource;
  readonly eventSink?: DatabaseEventSink | undefined;
}) {
  return {
    readFlagSnapshot: (accountId: string | null, keys: readonly string[]) =>
      instrumented(eventSink, 'readFlagSnapshot', () =>
        readFlagSnapshot(database, accountId, keys),
      ),
    runFlagCommand: (input: FlagCommandInput) =>
      instrumented(eventSink, 'runFlagCommand', () =>
        inTransaction(database, (tx) => runFlagCommand(tx, input)),
      ),
    purgeExpiredFlagOverrides: ({
      before,
      limit,
    }: {
      readonly before: string;
      readonly limit: number;
    }) =>
      instrumented(eventSink, 'purgeExpiredFlagOverrides', () =>
        inTransaction(database, async (tx) => {
          if (
            !Number.isSafeInteger(limit) ||
            limit < 1 ||
            limit > 500 ||
            !Number.isFinite(Date.parse(before))
          )
            throw createAppError('VALIDATION');
          await lockFlags(tx, 'write');
          const removed = await query(
            tx,
            z.object({ count: z.number() }),
            sql`with due as (
          select key, user_id from flag_account_overrides where expires_at <= least(${before}::timestamptz, clock_timestamp())
          order by expires_at, key, user_id limit ${limit}
        ), removed as (
          delete from flag_account_overrides o using due where o.key = due.key and o.user_id = due.user_id returning o.key
        ), revisions as (
          update release_flags set revision = revision + 1 where key in (select key from removed) returning key
        ) select count(*)::integer as count from removed`,
          );
          return removed[0]!.count;
        }),
      ),
    purgeExpiredFlagEvidence: ({
      before,
      limit,
    }: {
      readonly before: string;
      readonly limit: number;
    }) =>
      instrumented(eventSink, 'purgeExpiredFlagEvidence', async () => {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
          throw createAppError('VALIDATION');
        const [row] = await query(
          database,
          z.object({ count: z.number() }),
          sql`select public.daisy_purge_flag_evidence(${before}::timestamptz, ${limit}::integer) as count`,
        );
        if (!row) throw createAppError('INVARIANT');
        return row.count;
      }),
  };
}
