import { createAppError } from '@daisy/errors';
import {
  emailedNotificationKinds,
  type CompetitionType,
  type EmailedNotificationKind,
  type RatingLadder,
  type RoomSeatKind,
} from '@daisy/protocol';
import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { requireLeaseMs } from '../lease-policy';
import { rowsOf } from '../raw-rows';
import { deleteExpiredBatch, type RetentionBatch } from '../retention';
import { agentLeaseDigest } from '../round-agent-lease';
import {
  notificationEmails,
  type notificationEmailErrorCodes,
} from '../schema/notifications';

type Database = Pick<BunSQLDatabase, 'transaction' | 'execute' | 'update'>;

/** Sent notification emails one member may receive in any hour (ADR 0124). */
export const NOTIFICATION_EMAILS_PER_HOUR = 20;

export type NotificationEmailClaim = {
  readonly id: string;
  readonly kind: EmailedNotificationKind;
  /** Attempts including this one. */
  readonly attempts: number;
  /** The lease holder's bearer token; only its SHA3 digest is stored. */
  readonly token: string;
};

type ErrorCode = (typeof notificationEmailErrorCodes)[number];

/** What a claimed email should say right now; read fresh at send time. */
export type NotificationEmailDelivery =
  | {
      readonly kind: 'room_invitation';
      readonly to: string;
      readonly userId: string;
      readonly host: string;
      readonly roomId: string;
      readonly roomTitle: string;
      readonly seat: RoomSeatKind;
    }
  | {
      readonly kind: 'challenge_received';
      readonly to: string;
      readonly userId: string;
      readonly challenger: string;
      readonly mode: CompetitionType;
      readonly format: RatingLadder;
    }
  /** Nothing to send; the job ends cancelled with this reason. */
  | {
      readonly kind: 'cancel';
      readonly errorCode: Extract<
        ErrorCode,
        'recipient-gone' | 'not-owed' | 'preference-off' | 'rate-limited'
      >;
    };

export type NotificationEmailOutcome =
  | { readonly kind: 'sent' }
  | {
      readonly kind: 'retry';
      readonly errorCode: 'delivery' | 'delivery-unknown';
      readonly nextAttemptAt: string;
    }
  | { readonly kind: 'failed' | 'cancelled'; readonly errorCode: ErrorCode };

const claimRow = z.object({
  id: z.string(),
  kind: z.enum(emailedNotificationKinds),
  attempts: z.coerce.number().int().positive(),
});
const factsRow = z.object({
  kind: z.enum(emailedNotificationKinds),
  user_id: z.string(),
  email: z.string().nullable(),
  verified: z.boolean().nullable(),
  wants_email: z.boolean(),
  sent_last_hour: z.coerce.number().int().nonnegative(),
  notification_id: z.string().nullable(),
  about: z.string().nullable(),
  invitation_open: z.boolean().nullable(),
  room_id: z.string().nullable(),
  room_title: z.string().nullable(),
  seat: z.enum(['debater', 'judge']).nullable(),
  challenge_open: z.boolean().nullable(),
  mode: z.enum(['casual', 'ranked']).nullable(),
  format: z.string().nullable(),
});

/**
 * The notification email queue's store (ADR 0124). Claims take due jobs and
 * lapsed leases with `FOR UPDATE SKIP LOCKED`, so several web instances
 * never hold one job at once; only the current lease holder may settle it.
 * Provider calls happen outside any transaction.
 */
export function notificationEmailOperations({
  database,
  eventSink,
}: {
  readonly database: Database;
  readonly eventSink?: DatabaseEventSink | undefined;
}) {
  const held = (id: string, token: string) =>
    and(
      eq(notificationEmails.id, id),
      eq(notificationEmails.state, 'leased'),
      eq(notificationEmails.leaseTokenDigest, agentLeaseDigest(token)),
    );
  return {
    claimNotificationEmails: (input: {
      readonly limit: number;
      readonly leaseMs: number;
      readonly nextToken: () => string;
    }): Promise<readonly NotificationEmailClaim[]> =>
      instrumented(eventSink, 'claimNotificationEmails', async () => {
        requireLeaseMs(input.leaseMs);
        if (
          !Number.isSafeInteger(input.limit) ||
          input.limit < 1 ||
          input.limit > 50
        )
          throw createAppError('VALIDATION');
        return database.transaction(async (tx) => {
          const due = await rowsOf<{ id: string }>(
            tx,
            sql`select id from notification_emails
              where (state = 'queued' and next_attempt_at <= clock_timestamp())
                 or (state = 'leased' and lease_expires_at <= clock_timestamp())
              order by next_attempt_at, id
              limit ${input.limit}
              for update skip locked`,
          );
          const claims: NotificationEmailClaim[] = [];
          for (const { id } of due) {
            const token = input.nextToken();
            // A lapsed lease may have reached the provider: say so if it fails.
            const [row] = await rowsOf(
              tx,
              sql`update notification_emails set
                  last_error_code = case when state = 'leased' then 'delivery-unknown' else last_error_code end,
                  state = 'leased', attempts = attempts + 1,
                  lease_token_digest = ${agentLeaseDigest(token)},
                  lease_expires_at = clock_timestamp() + ${input.leaseMs} * interval '1 millisecond'
                where id = ${id}
                returning id, kind, attempts`,
            );
            claims.push({ ...claimRow.parse(row), token });
          }
          return claims;
        });
      }),
    /**
     * Reads what a claimed job should say now. It is cancelled when the
     * member is gone or unverified, turned the kind's email off, has had
     * the hour's emails, or the thing it is about no longer stands.
     */
    readNotificationEmailDelivery: (
      id: string,
    ): Promise<NotificationEmailDelivery> =>
      instrumented(eventSink, 'readNotificationEmailDelivery', async () => {
        const [raw] = await rowsOf(
          database,
          sql`select j.kind,j.user_id,u.email,u.email_verified as verified,
              coalesce((select np.enabled from notification_preferences np
                where np.user_id=j.user_id and np.kind=j.kind and np.channel='email'),true) as wants_email,
              (select count(*) from notification_emails s where s.user_id=j.user_id and s.state='sent'
                and s.completed_at > clock_timestamp() - interval '1 hour') as sent_last_hour,
              j.notification_id,au.username as about,
              (i.state='pending' and i.expires_at > clock_timestamp()
                and ro.status in ('assembling','ready')) as invitation_open,
              i.room_id,ro.title as room_title,i.seat,
              (c.room_id is null and c.expires_at > clock_timestamp()) as challenge_open,
              c.mode,c.format_id as format
            from notification_emails j
            left join users u on u.id=j.user_id and u.deleted_at is null
            left join notifications n on n.id=j.notification_id
            left join actors a on a.id=n.actor_id
            left join users au on au.id=a.user_id and au.deleted_at is null
            left join room_invitations i on i.id=n.room_invitation_id
            left join rooms ro on ro.id=i.room_id
            left join challenges c on c.id=n.challenge_id
            where j.id=${id}`,
        );
        if (!raw) throw createAppError('NOT_FOUND');
        const facts = factsRow.parse(raw);
        if (!facts.email || !facts.verified)
          return { kind: 'cancel', errorCode: 'recipient-gone' };
        if (!facts.wants_email)
          return { kind: 'cancel', errorCode: 'preference-off' };
        if (facts.notification_id === null || facts.about === null)
          return { kind: 'cancel', errorCode: 'not-owed' };
        if (facts.sent_last_hour >= NOTIFICATION_EMAILS_PER_HOUR)
          return { kind: 'cancel', errorCode: 'rate-limited' };
        if (facts.kind === 'room_invitation')
          return facts.invitation_open &&
            facts.room_id &&
            facts.room_title !== null &&
            facts.seat
            ? {
                kind: 'room_invitation',
                to: facts.email,
                userId: facts.user_id,
                host: facts.about,
                roomId: facts.room_id,
                roomTitle: facts.room_title,
                seat: facts.seat,
              }
            : { kind: 'cancel', errorCode: 'not-owed' };
        return facts.challenge_open && facts.mode && facts.format
          ? {
              kind: 'challenge_received',
              to: facts.email,
              userId: facts.user_id,
              challenger: facts.about,
              mode: facts.mode,
              format: facts.format as RatingLadder,
            }
          : { kind: 'cancel', errorCode: 'not-owed' };
      }),
    /** False when the lease lapsed and another worker may now hold the job. */
    settleNotificationEmail: (input: {
      readonly id: string;
      readonly token: string;
      readonly outcome: NotificationEmailOutcome;
    }): Promise<boolean> =>
      instrumented(eventSink, 'settleNotificationEmail', async () => {
        const { outcome } = input;
        const release = { leaseTokenDigest: null, leaseExpiresAt: null };
        // An unknown earlier send stays unknown: it may have been delivered.
        const keepUnknown = (code: string) =>
          sql`case when last_error_code = 'delivery-unknown' then 'delivery-unknown' else ${code} end`;
        const set =
          outcome.kind === 'retry'
            ? {
                ...release,
                state: 'queued' as const,
                lastErrorCode: keepUnknown(outcome.errorCode),
                nextAttemptAt: sql`${outcome.nextAttemptAt}::timestamptz`,
              }
            : {
                ...release,
                state: outcome.kind,
                lastErrorCode:
                  outcome.kind === 'sent'
                    ? null
                    : outcome.kind === 'failed'
                      ? keepUnknown(outcome.errorCode)
                      : outcome.errorCode,
                completedAt: sql`clock_timestamp()`,
              };
        const settled = await database
          .update(notificationEmails)
          .set(set)
          .where(held(input.id, input.token))
          .returning({ id: notificationEmails.id });
        return settled.length === 1;
      }),
    /** Terminal jobs only, 30 days after they ended: a live job has no `completed_at`. */
    purgeExpiredNotificationEmails: (batch: RetentionBatch) =>
      instrumented(eventSink, 'purgeExpiredNotificationEmails', () =>
        deleteExpiredBatch(
          database,
          {
            table: notificationEmails,
            key: notificationEmails.id,
            at: notificationEmails.completedAt,
          },
          batch,
        ),
      ),
  };
}
