import { canInviteClaimedPreapproval } from './beta-preapproval-decision';
import { normalizedEmailSql } from './email-identity';
import { loadAuthorizationAccount } from './authorization';
import { createAppError } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';
import { DIGEST_WINDOW } from './beta-access';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { mailIntentQueue } from './mail-intent-queue';
import type { MailJobClaimInput, MailJobOutcome } from './mail-queue';
import { deleteExpiredBatch, type RetentionBatch } from './retention';
import {
  mailIntentErrorCodes,
  mailIntents,
  mailIntentPurposes,
} from './schema/mail-intents';

type Database = Pick<BunSQLDatabase, 'transaction' | 'execute'>;

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
      readonly kind: 'invitation';
      readonly to: string;
      readonly sendBefore: string;
    }
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

export type MailIntentOutcome = MailJobOutcome<
  (typeof mailIntentErrorCodes)[number]
>;

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
  return {
    claimMailIntents: (
      input: MailJobClaimInput,
    ): Promise<readonly MailIntentClaim[]> =>
      instrumented(eventSink, 'claimMailIntents', async () =>
        (
          await mailIntentQueue.claimDue(
            database,
            input,
            sql`id, purpose, attempts`,
          )
        ).map(({ row, token }) => ({ ...claimRow.parse(row), token })),
      ),
    readMailIntentDelivery: (id: string): Promise<MailIntentDelivery> =>
      instrumented(eventSink, 'readMailIntentDelivery', async () => {
        // A digest counts its own window, which retries never move.
        const [intent] =
          (await database.execute(sql`select purpose, recipient_user_id, preapproval_id, state, window_start,
            to_char((created_at + interval '23 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as invitation_deadline
          from mail_intents where id = ${id}`)) as unknown as {
            purpose: string;
            invitation_deadline: string;
            state: string;
            preapproval_id: string | null;
            recipient_user_id: string | null;
            window_start: Date | null;
          }[];
        if (!intent) throw createAppError('NOT_FOUND');
        if (intent.purpose === 'beta-invitation') {
          if (intent.state !== 'leased') return { kind: 'not-owed' };
          const [grant] =
            (await database.execute(sql`select p.email, p.claimed_user_id from beta_preapprovals p
            left join users u on u.id = p.claimed_user_id
            left join account_beta_access b on b.user_id = p.claimed_user_id
            where p.id = ${intent.preapproval_id} and (p.claimed_user_id is null or (u.deleted_at is null and u.email_verified and ${normalizedEmailSql(sql`u.email`)} = p.email and b.state = 'approved'))`)) as unknown as {
              email: string;
              claimed_user_id: string | null;
            }[];
          if (!grant) return { kind: 'not-owed' };
          if (grant.claimed_user_id) {
            const account = await loadAuthorizationAccount(
              database,
              grant.claimed_user_id,
            );
            if (
              !account ||
              !canInviteClaimedPreapproval({
                verified: true,
                emailMatches: true,
                erased: account.erased,
                restricted: account.restricted,
                state: account.beta?.state ?? null,
                ageBand: account.ageBand,
              })
            )
              return { kind: 'not-owed' };
          }
          const accounts = (await database.execute(
            sql`select id from users where ${normalizedEmailSql(sql`email`)} = ${grant.email} and email_verified`,
          )) as unknown as { id: string }[];
          for (const account of accounts) {
            const fact = await loadAuthorizationAccount(database, account.id);
            if (
              fact?.erased ||
              fact?.restricted ||
              fact?.beta?.state === 'revoked'
            )
              return { kind: 'not-owed' };
          }
          return {
            kind: 'invitation',
            to: grant.email,
            sendBefore: intent.invitation_deadline,
          };
        }
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
      instrumented(eventSink, 'settleMailIntent', () =>
        mailIntentQueue.settle(database, input),
      ),
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
