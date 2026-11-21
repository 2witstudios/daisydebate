import { createAppError } from '@daisy/errors';
import type { EmailedNotificationKind } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';
import type { AuthorizationTransaction } from '../authorization';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import {
  mailQueue,
  type MailJobClaimInput,
  type MailJobOutcome,
} from '../mail-queue';
import { rowsOf } from '../raw-rows';
import { retriedOnceIfQueuedMeanwhile } from '../mail-queue';
import { deleteExpiredBatch, type RetentionBatch } from '../retention';
import {
  notificationDigests,
  type notificationDigestErrorCodes,
} from '../schema/notifications';
import { readInboxRows, type InboxRow } from './inbox';
import { wants } from './preferences';
import { emailsMember } from './presentation';
import { notificationStands } from './standing';
import { scopeTransaction } from '../tenant-scope';

type Database = Pick<BunSQLDatabase, 'transaction' | 'execute'>;

/** A digest waits this long after its latest notification, so a burst is one email. */
const DIGEST_QUIET_MS = 15 * 60_000;
/** ...but never longer than this after its first. */
const DIGEST_LONGEST_WAIT_MS = 60 * 60_000;

export type NotificationDigestClaim = {
  readonly id: string;
  /** Attempts including this one. */
  readonly attempts: number;
  /** The lease holder's bearer token; only its SHA3 digest is stored. */
  readonly token: string;
};

type ErrorCode = (typeof notificationDigestErrorCodes)[number];

/** What a claimed digest should say right now; read fresh at send time. */
export type NotificationDigestDelivery =
  | {
      readonly kind: 'send';
      readonly to: string;
      readonly userId: string;
      /** The member's actor: a digest waits while they are online. */
      readonly actorId: string;
      /** Newest first, each unread, still standing and still wanted by email. */
      readonly items: readonly InboxRow[];
    }
  /** Nothing to send; the job ends cancelled with this reason. */
  | {
      readonly kind: 'cancel';
      readonly errorCode: Extract<ErrorCode, 'recipient-gone' | 'not-owed'>;
    };

export type NotificationDigestOutcome = MailJobOutcome<ErrorCode>;

/** Any lapsed lease may have reached the provider. */
const queue = mailQueue(notificationDigests, { unknownAfterLapse: sql`true` });

const claimRow = z.object({
  id: z.string(),
  attempts: z.coerce.number().int().positive(),
});

/** The most items one digest lists; the rest wait in the inbox it links to. */
const DIGEST_ITEMS = 20;

/**
 * Gathers just-written notifications of an emailed kind into each member's
 * queued digest, in the producer's transaction: a member with none queued
 * gets one, and each owed notification pushes its send back to a quiet time
 * after `at`, never past the longest wait after its first (ADR 0144). A
 * member who turned this kind's email off, or all email, is owed none.
 */
export async function oweDigests(
  tx: AuthorizationTransaction,
  owed: {
    readonly kind: EmailedNotificationKind;
    readonly rows: readonly { readonly id: string; readonly userId: string }[];
    readonly at: string;
    readonly nextId: () => string;
  },
): Promise<void> {
  const members = [...new Set(owed.rows.map((row) => row.userId))];
  if (members.length === 0) return;
  const digests = JSON.stringify(
    members.map((userId) => ({ id: owed.nextId(), user_id: userId })),
  );
  const rows = JSON.stringify(owed.rows.map((row) => row.id));
  const at = sql`${owed.at}::timestamptz`;
  await tx.execute(sql`with d as (
      insert into notification_digests(id,user_id,first_owed_at,state,attempts,next_attempt_at,created_at)
      select j.id,j.user_id,${at},'queued',0,${at}+${DIGEST_QUIET_MS}*interval '1 millisecond',${at}
      from jsonb_to_recordset(${digests}::text::jsonb) as j(id text,user_id text)
      where ${wants(owed.kind, 'email', sql`j.user_id`)} and ${emailsMember(sql`j.user_id`)}
      on conflict (user_id) where state='queued' do update set next_attempt_at=least(
        greatest(notification_digests.next_attempt_at,excluded.next_attempt_at),
        notification_digests.first_owed_at+${DIGEST_LONGEST_WAIT_MS}*interval '1 millisecond')
      returning id,user_id)
    update notifications n set digest_id=d.id from d
    where n.user_id=d.user_id
      and n.id in (select jsonb_array_elements_text(${rows}::text::jsonb))`);
}

/**
 * The notification digest queue's store (ADR 0144). Claims take due jobs and
 * lapsed leases with `FOR UPDATE SKIP LOCKED`, so several web instances
 * never hold one job at once; only the current lease holder may settle it.
 * Provider calls happen outside any transaction.
 */
export function notificationDigestOperations({
  database,
  eventSink,
}: {
  readonly database: Database;
  readonly eventSink?: DatabaseEventSink | undefined;
}) {
  return {
    claimNotificationDigests: (
      input: MailJobClaimInput,
    ): Promise<readonly NotificationDigestClaim[]> =>
      instrumented(eventSink, 'claimNotificationDigests', async () =>
        (await queue.claimDue(database, input, sql`id, attempts`)).map(
          ({ row, token }) => ({ ...claimRow.parse(row), token }),
        ),
      ),
    /**
     * Reads what a claimed digest should say now: its notifications that are
     * unread, still stand, and are still wanted by email. It is cancelled
     * when the member is gone or unverified, stopped all email, or none are
     * left.
     */
    readNotificationDigestDelivery: (
      id: string,
    ): Promise<NotificationDigestDelivery> =>
      instrumented(eventSink, 'readNotificationDigestDelivery', async () => {
        const [member] = await rowsOf<{
          user_id: string;
          actor_id: string | null;
          email: string | null;
          verified: boolean | null;
          emails: boolean;
        }>(
          database,
          sql`select d.user_id,a.id as actor_id,u.email,u.email_verified as verified,
              ${emailsMember(sql`d.user_id`)} as emails
            from notification_digests d
            left join users u on u.id=d.user_id and u.deleted_at is null
            left join actors a on a.user_id=u.id
            where d.id=${id}`,
        );
        if (!member) throw createAppError('NOT_FOUND');
        if (!member.email || !member.verified || !member.actor_id)
          return { kind: 'cancel', errorCode: 'recipient-gone' };
        if (!member.emails) return { kind: 'cancel', errorCode: 'not-owed' };
        const items = await database.transaction(async (tx) => {
          await scopeTransaction(tx, { subjectUserId: member.user_id });
          return readInboxRows(tx, {
            where: sql`n.digest_id=${id} and n.user_id=${member.user_id} and n.read_at is null
                and ${notificationStands(sql`clock_timestamp()`)}
                and ${wants(sql`n.kind`, 'email', sql`n.user_id`)}`,
            limit: DIGEST_ITEMS,
          });
        });
        return items.length === 0
          ? { kind: 'cancel', errorCode: 'not-owed' }
          : {
              kind: 'send',
              to: member.email,
              userId: member.user_id,
              actorId: member.actor_id,
              items,
            };
      }),
    /** False when the lease lapsed and another worker may now hold the job. */
    settleNotificationDigest: (input: {
      readonly id: string;
      readonly token: string;
      readonly outcome: NotificationDigestOutcome;
    }): Promise<boolean> =>
      instrumented(eventSink, 'settleNotificationDigest', () =>
        queue.settle(database, input),
      ),
    /**
     * Waits again: its member is in Daisy and sees these there. When another
     * digest was owed meanwhile, this one's notifications join it and this
     * one ends, so a member still has at most one queued. False when the
     * lease lapsed.
     */
    postponeNotificationDigest: (input: {
      readonly id: string;
      readonly token: string;
      readonly until: string;
    }): Promise<boolean> =>
      instrumented(eventSink, 'postponeNotificationDigest', () =>
        // A job owed while this one was held can take the one queued place
        // first; the second attempt then sees it and joins it.
        retriedOnceIfQueuedMeanwhile(() =>
          database.transaction(async (tx) => {
            const [next] = await rowsOf<{ id: string }>(
              tx,
              sql`select q.id from notification_digests q
              join notification_digests d on d.user_id=q.user_id and d.id=${input.id}
              where q.state='queued' for update of q`,
            );
            if (!next) return queue.postpone(tx, input);
            const ended = await queue.settle(tx, {
              id: input.id,
              token: input.token,
              outcome: { kind: 'cancelled', errorCode: 'not-owed' },
            });
            if (ended)
              await tx.execute(sql`update notifications set digest_id=${next.id}
              where digest_id=${input.id}`);
            return ended;
          }),
        ),
      ),
    /** Terminal jobs only, 30 days after they ended: a live job has no `completed_at`. */
    purgeExpiredNotificationDigests: (batch: RetentionBatch) =>
      instrumented(eventSink, 'purgeExpiredNotificationDigests', () =>
        deleteExpiredBatch(
          database,
          {
            table: notificationDigests,
            key: notificationDigests.id,
            at: notificationDigests.completedAt,
          },
          batch,
        ),
      ),
  };
}
