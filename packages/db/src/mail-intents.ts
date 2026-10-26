import { createAppError } from '@daisy/errors';
import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';
import { DIGEST_WINDOW } from './beta-access';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { requireLeaseMs } from './lease-policy';
import { deleteExpiredBatch, type RetentionBatch } from './retention';
import { agentLeaseDigest } from './round-agent-lease';
import { mailIntents, mailIntentPurposes } from './schema/mail-intents';

type Database = Pick<BunSQLDatabase, 'transaction' | 'execute' | 'update'>;

export type MailIntentClaim = {
  readonly id: string;
  readonly purpose: (typeof mailIntentPurposes)[number];
  /** Attempts including this one. */
  readonly attempts: number;
  /** The lease holder's bearer token; only its SHA3 digest is stored. */
  readonly token: string;
};

/** What a claimed intent should say right now; read fresh at send time. */
export type MailIntentDelivery =
  | {
      readonly kind: 'member';
      readonly to: string;
      readonly username: string;
    }
  | {
      readonly kind: 'owner-digest';
      /** Accounts that joined in the digest's window and still wait. */
      readonly newRequests: number;
      /** Every account still waiting. */
      readonly waiting: number;
    }
  /** The recipient was erased or lost their address. */
  | { readonly kind: 'recipient-gone' }
  /** The mail is no longer owed: access was revoked, or nobody new waits. */
  | { readonly kind: 'not-owed' };

export type MailIntentOutcome =
  | { readonly kind: 'sent' }
  | {
      readonly kind: 'retry';
      readonly errorCode: 'delivery';
      readonly nextAttemptAt: string;
    }
  | {
      readonly kind: 'failed' | 'cancelled';
      readonly errorCode:
        | 'delivery'
        | 'suppressed'
        | 'recipient-gone'
        | 'unconfigured'
        | 'not-owed';
    };

const claimRow = z.object({
  id: z.string(),
  purpose: z.enum(mailIntentPurposes),
  attempts: z.coerce.number().int().positive(),
});
const memberRow = z.object({
  email: z.string().nullable(),
  username: z.string().nullable(),
  state: z.string().nullable(),
});
const digestRow = z.object({
  new_requests: z.coerce.number().int().nonnegative(),
  waiting: z.coerce.number().int().nonnegative(),
});

/**
 * The durable mail queue's store (ADR 0075). Claims take due intents and
 * lapsed leases with `FOR UPDATE SKIP LOCKED`, so several web instances
 * never hold one intent at once; only the current lease holder may settle
 * it. Provider calls happen outside any transaction.
 */
export function mailIntentOperations({
  database,
  eventSink,
}: {
  readonly database: Database;
  readonly eventSink: DatabaseEventSink | undefined;
}) {
  const held = (id: string, token: string) =>
    and(
      eq(mailIntents.id, id),
      eq(mailIntents.state, 'leased'),
      eq(mailIntents.leaseTokenDigest, agentLeaseDigest(token)),
    );
  return {
    claimMailIntents: (input: {
      readonly limit: number;
      readonly leaseMs: number;
      readonly nextToken: () => string;
    }): Promise<readonly MailIntentClaim[]> =>
      instrumented(eventSink, 'claimMailIntents', async () => {
        requireLeaseMs(input.leaseMs);
        if (
          !Number.isSafeInteger(input.limit) ||
          input.limit < 1 ||
          input.limit > 50
        )
          throw createAppError('VALIDATION');
        return database.transaction(async (tx) => {
          const due = (await tx.execute(sql`select id from mail_intents
            where (state = 'queued' and next_attempt_at <= clock_timestamp())
               or (state = 'leased' and lease_expires_at <= clock_timestamp())
            order by next_attempt_at, id
            limit ${input.limit}
            for update skip locked`)) as unknown as { id: string }[];
          const claims: MailIntentClaim[] = [];
          for (const { id } of due) {
            const token = input.nextToken();
            const [row] = (await tx.execute(sql`update mail_intents set
                state = 'leased', attempts = attempts + 1,
                lease_token_digest = ${agentLeaseDigest(token)},
                lease_expires_at = clock_timestamp() + ${input.leaseMs} * interval '1 millisecond'
              where id = ${id}
              returning id, purpose, attempts`)) as unknown as unknown[];
            claims.push({ ...claimRow.parse(row), token });
          }
          return claims;
        });
      }),
    readMailIntentDelivery: (id: string): Promise<MailIntentDelivery> =>
      instrumented(eventSink, 'readMailIntentDelivery', async () => {
        // A digest's window is its dedupe key (`beta-requests:<UTC start>`),
        // which retries never move, unlike `next_attempt_at`.
        const [intent] =
          (await database.execute(sql`select purpose, recipient_user_id,
            case when purpose = 'beta-requests-digest'
              then (substr(dedupe_key, 15, 16) || ':00+00')::timestamptz end as window_start
          from mail_intents where id = ${id}`)) as unknown as {
            purpose: string;
            recipient_user_id: string | null;
            window_start: Date | null;
          }[];
        if (!intent) throw createAppError('NOT_FOUND');
        if (intent.purpose === 'beta-approved') {
          const [row] =
            (await database.execute(sql`select u.email, u.username, b.state
            from users u left join account_beta_access b on b.user_id = u.id
            where u.id = ${intent.recipient_user_id} and u.deleted_at is null`)) as unknown as unknown[];
          const member = row ? memberRow.parse(row) : null;
          if (!member?.email || !member.username)
            return { kind: 'recipient-gone' };
          if (member.state !== 'approved') return { kind: 'not-owed' };
          return {
            kind: 'member',
            to: member.email,
            username: member.username,
          };
        }
        const [row] = (await database.execute(sql`select
            count(*) filter (where requested_at >= ${intent.window_start}
              and requested_at < ${intent.window_start}::timestamptz + ${DIGEST_WINDOW}) as new_requests,
            count(*) as waiting
          from account_beta_access where state = 'pending'`)) as unknown as unknown[];
        const digest = digestRow.parse(row);
        return digest.new_requests === 0
          ? { kind: 'not-owed' }
          : {
              kind: 'owner-digest',
              newRequests: digest.new_requests,
              waiting: digest.waiting,
            };
      }),
    /** False when the lease lapsed and another worker may now hold the intent. */
    settleMailIntent: (input: {
      readonly id: string;
      readonly token: string;
      readonly outcome: MailIntentOutcome;
    }): Promise<boolean> =>
      instrumented(eventSink, 'settleMailIntent', async () => {
        const { outcome } = input;
        const release = { leaseTokenDigest: null, leaseExpiresAt: null };
        const set =
          outcome.kind === 'retry'
            ? {
                ...release,
                state: 'queued' as const,
                lastErrorCode: outcome.errorCode,
                nextAttemptAt: sql`${outcome.nextAttemptAt}::timestamptz`,
              }
            : {
                ...release,
                state: outcome.kind,
                lastErrorCode:
                  outcome.kind === 'sent' ? null : outcome.errorCode,
                completedAt: sql`clock_timestamp()`,
              };
        const settled = await database
          .update(mailIntents)
          .set(set)
          .where(held(input.id, input.token))
          .returning({ id: mailIntents.id });
        return settled.length === 1;
      }),
    /** Terminal intents only: a queued or leased intent has no `completed_at`. */
    purgeExpiredMailIntents: (batch: RetentionBatch) =>
      instrumented(eventSink, 'purgeExpiredMailIntents', () =>
        deleteExpiredBatch(
          database,
          {
            table: mailIntents,
            key: mailIntents.id,
            at: mailIntents.completedAt,
          },
          batch,
        ),
      ),
  };
}
