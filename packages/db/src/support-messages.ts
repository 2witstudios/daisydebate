import { mailJobStates } from './schema/columns';
import { listedWord } from './lifecycle-sql';
import { commandDigest } from '@daisy/digest';
import {
  supportTopics,
  type SupportMessage,
} from '@daisy/protocol/support-message';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { instrumented, type DatabaseEventSink } from './instrumented';
import {
  mailQueue,
  type MailJobClaimInput,
  type MailJobOutcome,
} from './mail-queue';
import { query } from './raw-rows';
import { deleteExpiredBatch, type RetentionBatch } from './retention';
import {
  supportMessageNoticeErrorCodes,
  supportMessages,
} from './schema/support-messages';
import type { TxSource } from './tx';

/**
 * A lapsed lease is not marked `delivery-unknown`: the next claim sends the
 * notice again, and only the provider idempotency key (the message id)
 * keeps that resend from reaching the owner twice.
 */
const noticeQueue = mailQueue(supportMessages, {
  unknownAfterLapse: sql`false`,
});

export type SupportMessageNoticeClaim = {
  readonly id: string;
  readonly attempts: number;
  /** The lease holder's bearer token; only its SHA3 digest is stored. */
  readonly token: string;
};

/** What a claimed notice should say right now, read fresh at send time. */
export type SupportMessageNotice =
  | {
      readonly kind: 'message';
      readonly message: Omit<SupportMessage, 'v' | 'messageId'> & {
        readonly id: string;
        /** The sender's username when they were signed in and still hold one; null otherwise. */
        readonly memberUsername: string | null;
        /** UTC ISO instant the message was sent. */
        readonly receivedAt: string;
      };
    }
  /** The message was deleted (retention or erasure) before its notice went. */
  | { readonly kind: 'gone' };

export type SupportMessageNoticeOutcome = MailJobOutcome<
  (typeof supportMessageNoticeErrorCodes)[number]
>;

const claimRow = z.object({
  id: z.string(),
  attempts: z.coerce.number().int().positive(),
});

const messageRow = z.object({
  id: z.string(),
  topic: z.enum(supportTopics),
  message: z.string(),
  about: z.string().nullable(),
  reply_email: z.string(),
  member_username: z.string().nullable(),
  received_at: z.string(),
});

/**
 * One digest of a message's own fields and its sender (SHA3-256 over their
 * JSON, in a fixed order), so a sent form's every version is found by (form
 * id, digest) without comparing columns, and a resend of any version is
 * stored once.
 */
const supportMessageDigest = (
  message: SupportMessage,
  memberUserId: string | null,
): string =>
  commandDigest([
    message.topic,
    message.message,
    message.about,
    message.replyEmail,
    memberUserId,
  ]);

/**
 * Support messages (SUPP-1): stored once per message id, then told to the
 * owner through the shared mail job lifecycle (`mailQueue`). Provider calls
 * happen outside any transaction; only the current lease holder settles.
 */
export function supportMessageOperations({
  database,
  eventSink,
}: {
  readonly database: TxSource;
  readonly eventSink: DatabaseEventSink | undefined;
}) {
  return {
    /**
     * Whether this exact version of a sent form is already stored: a resend
     * after a lost answer, which needs no new allowance and changes nothing.
     */
    supportMessageUnchanged: (
      message: SupportMessage,
      memberUserId: string | null,
    ): Promise<boolean> =>
      instrumented(eventSink, 'supportMessageUnchanged', async () => {
        const rows = await query(
          database,
          z.object({ present: z.literal(1) }),
          sql`select 1 as present from support_messages where form_id = ${message.messageId}
            and fields_digest = ${supportMessageDigest(message, memberUserId)}`,
        );
        return rows.length === 1;
      }),
    /**
     * Stores a validated message with its email queued now, once per
     * version of a sent form: (form id, digest) is unique, so a resend of
     * any version after a lost answer is left as it is. The form's first
     * version is stored under the form's id; a changed version is a new
     * message under `newId`. A stored message never changes, because a
     * message id is an identifier, not an edit credential (ADR 0018).
     */
    recordSupportMessage: (input: {
      readonly message: SupportMessage;
      /** The account signed in when it was sent, read from the session; null for a visitor. */
      readonly memberUserId: string | null;
      readonly newId: string;
    }): Promise<void> =>
      instrumented(eventSink, 'recordSupportMessage', async () => {
        const { message, memberUserId } = input;
        const insert = (id: string) =>
          query(
            database,
            z.object({ id: z.string() }),
            sql`insert into support_messages (
              id, form_id, fields_digest, topic, message, about, reply_email,
              member_user_id, next_attempt_at
            ) values (
              ${id}, ${message.messageId}, ${supportMessageDigest(message, memberUserId)},
              ${message.topic}, ${message.message},
              ${message.about === '' ? null : message.about},
              ${message.replyEmail}, ${memberUserId}, clock_timestamp()
            ) on conflict do nothing returning id`,
          );
        // The form's id is taken only by its first version; any version
        // already stored makes the second insert a no-op on (form, digest).
        if ((await insert(message.messageId)).length === 0)
          await insert(input.newId);
      }),
    /**
     * The address a signed-in sender's reply goes to unless they change it:
     * their account's email, or null for an account that has none.
     */
    readSupportReplyAddress: (userId: string): Promise<string | null> =>
      instrumented(eventSink, 'readSupportReplyAddress', async () => {
        const [row] = await query(
          database,
          z.object({ email: z.string().nullable() }),
          sql`select email from users where id = ${userId} and deleted_at is null`,
        );
        return row?.email ?? null;
      }),
    claimSupportMessageNotices: (
      input: MailJobClaimInput,
    ): Promise<readonly SupportMessageNoticeClaim[]> =>
      instrumented(eventSink, 'claimSupportMessageNotices', async () =>
        (
          await noticeQueue.claimDue(
            database,
            input,
            sql`id, attempts`,
            claimRow,
          )
        ).map(({ row, token }) => ({ ...row, token })),
      ),
    readSupportMessageNotice: (id: string): Promise<SupportMessageNotice> =>
      instrumented(eventSink, 'readSupportMessageNotice', async () => {
        const [row] = await query(
          database,
          z.object({
            id: z.string(),
            topic: z.string(),
            message: z.string(),
            about: z.string().nullable(),
            reply_email: z.string(),
            member_username: z.string().nullable(),
            received_at: z.string(),
          }),
          sql`select m.id, m.topic, m.message, m.about, m.reply_email,
              u.username as member_username,
              to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as received_at
            from support_messages m
            left join users u on u.id = m.member_user_id and u.deleted_at is null
            where m.id = ${id}`,
        );
        if (!row) return { kind: 'gone' };
        const stored = messageRow.parse(row);
        return {
          kind: 'message',
          message: {
            id: stored.id,
            topic: stored.topic,
            message: stored.message,
            about: stored.about ?? '',
            replyEmail: stored.reply_email,
            memberUsername: stored.member_username,
            receivedAt: stored.received_at,
          },
        };
      }),
    /** False when the lease lapsed and another worker may now hold the notice. */
    settleSupportMessageNotice: (input: {
      readonly id: string;
      readonly token: string;
      readonly outcome: SupportMessageNoticeOutcome;
    }): Promise<boolean> =>
      instrumented(eventSink, 'settleSupportMessageNotice', () =>
        noticeQueue.settle(database, input),
      ),
    /**
     * Deletes messages sent before the cutoff (the sweep passes 365 days),
     * whether their notice went or not, except one a worker holds now.
     */
    purgeExpiredSupportMessages: (batch: RetentionBatch): Promise<number> =>
      instrumented(eventSink, 'purgeExpiredSupportMessages', () =>
        deleteExpiredBatch(
          database,
          {
            table: supportMessages,
            key: supportMessages.id,
            at: supportMessages.createdAt,
            eligible: sql`${supportMessages.state} <> ${listedWord(mailJobStates, 'leased')}`,
          },
          batch,
        ),
      ),
  };
}
