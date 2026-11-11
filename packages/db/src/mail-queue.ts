import { createAppError } from '@daisy/errors';
import { sql, type SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { PgTable } from 'drizzle-orm/pg-core';
import { requireLeaseMs } from './lease-policy';
import { rowsOf } from './raw-rows';
import { agentLeaseDigest } from './round-agent-lease';

type Execute = Pick<BunSQLDatabase, 'execute'>;

/** How a held mail job ends, or that it waits for another attempt. */
export type MailJobOutcome<ErrorCode extends string> =
  | { readonly kind: 'sent' }
  | {
      readonly kind: 'retry';
      readonly errorCode: 'delivery' | 'delivery-unknown';
      readonly nextAttemptAt: string;
    }
  | { readonly kind: 'failed' | 'cancelled'; readonly errorCode: ErrorCode };

export type MailJobClaimInput = {
  readonly limit: number;
  readonly leaseMs: number;
  /** A job claimed this many times already is not sent again: it ends failed. */
  readonly maxAttempts: number;
  readonly nextToken: () => string;
};

/** One claimed job's row as the table describes it, and its lease's bearer token. */
type Claimed = { readonly row: unknown; readonly token: string };

const MAX_CLAIM = 50;

/**
 * The one writer of a queued mail job's lifecycle, for any table built from
 * `mailJobColumns` (ADR 0075, ADR 0124): queued, leased by one worker at a
 * time, and ended sent, failed or cancelled. Every instant is the database's
 * clock at the write. `unknownAfterLapse` names the jobs whose lapsed lease
 * may have reached the provider: such a job says `delivery-unknown` from then
 * on, whatever ends it short of a confirmed send.
 */
export const mailQueue = (
  table: PgTable,
  options: { readonly unknownAfterLapse: SQL },
) => {
  /** An earlier send that may have landed stays unknown under any later reason. */
  const keptUnknown = (code: string) =>
    sql`case when last_error_code = 'delivery-unknown' then 'delivery-unknown' else ${code} end`;
  /** The same, for a job taken from a holder that never settled it. */
  const unknownIfHeld = (code: string | SQL) =>
    sql`case when last_error_code = 'delivery-unknown' or (state = 'leased' and (${options.unknownAfterLapse}))
      then 'delivery-unknown' else ${code} end`;
  return {
    /**
     * Leases the due jobs and the lapsed leases, oldest first, each to one
     * worker (`FOR UPDATE SKIP LOCKED`). A job already claimed `maxAttempts`
     * times ends failed here instead, so a worker that keeps dying after its
     * claim cannot hold a job in the queue for ever.
     */
    claimDue: (
      database: Pick<BunSQLDatabase, 'transaction'>,
      input: MailJobClaimInput,
      returning: SQL,
    ): Promise<readonly Claimed[]> => {
      requireLeaseMs(input.leaseMs);
      for (const [value, most] of [
        [input.limit, MAX_CLAIM],
        [input.maxAttempts, 1000],
      ] as const)
        if (!Number.isSafeInteger(value) || value < 1 || value > most)
          throw createAppError('VALIDATION');
      return database.transaction(async (tx) => {
        const due = await rowsOf<{ id: string; spent: boolean }>(
          tx,
          sql`select id, attempts >= ${input.maxAttempts} as spent from ${table}
            where (state = 'queued' and next_attempt_at <= clock_timestamp())
               or (state = 'leased' and lease_expires_at <= clock_timestamp())
            order by next_attempt_at, id
            limit ${input.limit}
            for update skip locked`,
        );
        const claims: Claimed[] = [];
        for (const { id, spent } of due) {
          if (spent) {
            await tx.execute(sql`update ${table} set
                last_error_code = ${unknownIfHeld('delivery')},
                state = 'failed', completed_at = clock_timestamp(),
                lease_token_digest = null, lease_expires_at = null
              where id = ${id}`);
            continue;
          }
          const token = input.nextToken();
          const [row] = await rowsOf(
            tx,
            sql`update ${table} set
                last_error_code = ${unknownIfHeld(sql`last_error_code`)},
                state = 'leased', attempts = attempts + 1,
                lease_token_digest = ${agentLeaseDigest(token)},
                lease_expires_at = clock_timestamp() + ${input.leaseMs} * interval '1 millisecond'
              where id = ${id}
              returning ${returning}`,
          );
          claims.push({ row, token });
        }
        return claims;
      });
    },
    /** False when the lease lapsed and another worker may now hold the job. */
    settle: async <ErrorCode extends string>(
      database: Execute,
      input: {
        readonly id: string;
        readonly token: string;
        readonly outcome: MailJobOutcome<ErrorCode>;
      },
    ): Promise<boolean> => {
      const { outcome } = input;
      const moved =
        outcome.kind === 'retry'
          ? sql`state = 'queued', last_error_code = ${keptUnknown(outcome.errorCode)},
              next_attempt_at = ${outcome.nextAttemptAt}::timestamptz`
          : sql`state = ${outcome.kind}, completed_at = clock_timestamp(),
              last_error_code = ${outcome.kind === 'sent' ? sql`null` : keptUnknown(outcome.errorCode)}`;
      const settled = await rowsOf(
        database,
        sql`update ${table} set ${moved}, lease_token_digest = null, lease_expires_at = null
          where id = ${input.id} and state = 'leased'
            and lease_token_digest = ${agentLeaseDigest(input.token)}
          returning id`,
      );
      return settled.length === 1;
    },
    /**
     * Cancels the jobs of `owed` that have not ended, held or not: what they
     * were for no longer stands. A provider request already in flight cannot
     * be recalled, so a held job ends `delivery-unknown`.
     */
    cancelOwed: async (tx: Execute, owed: SQL): Promise<void> => {
      await tx.execute(sql`update ${table} set
          last_error_code = ${unknownIfHeld('not-owed')},
          state = 'cancelled', completed_at = clock_timestamp(),
          lease_token_digest = null, lease_expires_at = null
        where state in ('queued', 'leased') and (${owed})`);
    },
  };
};
