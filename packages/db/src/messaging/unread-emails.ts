import { createAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import {
  mailQueue,
  type MailJobClaimInput,
  type MailJobOutcome,
} from '../mail-queue';
import { emailsMember } from '../notifications/presentation';
import { rowsOf, run, query } from '../raw-rows';
import { retriedOnceIfQueuedMeanwhile } from '../mail-queue';
import { deleteExpiredBatch, type RetentionBatch } from '../retention';
import {
  messagingUnreadEmails,
  type messagingUnreadEmailErrorCodes,
} from '../schema/messaging-unread-emails';
import { inTransaction, type Tx, type TxSource } from '../tx';

/** An unread-messages email waits this long after the latest message... */
const UNREAD_EMAIL_QUIET_MS = 30 * 60_000;
/** ...but never longer than this after the first. */
const UNREAD_EMAIL_LONGEST_WAIT_MS = 2 * 60 * 60_000;

type ErrorCode = (typeof messagingUnreadEmailErrorCodes)[number];

export type MessagingUnreadEmailClaim = {
  readonly id: string;
  readonly attempts: number;
  readonly token: string;
};

/** What a claimed email should say now: how many conversations wait, no more. */
export type MessagingUnreadEmailDelivery =
  | {
      readonly kind: 'send';
      readonly to: string;
      readonly userId: string;
      readonly actorId: string;
      readonly conversations: number;
    }
  | {
      readonly kind: 'cancel';
      readonly errorCode: Extract<ErrorCode, 'recipient-gone' | 'not-owed'>;
    };

export type MessagingUnreadEmailOutcome = MailJobOutcome<ErrorCode>;

const queue = mailQueue(messagingUnreadEmails, {
  unknownAfterLapse: sql`true`,
});

const claimRow = z.object({
  id: z.string(),
  attempts: z.coerce.number().int().positive(),
});

/** The members of a conversation: a DM's pair, or a group's live grants. */
const membersOf = (channelId: SQL) => sql`
  select low_actor_id as actor_id from public.messaging_dm_pairs where channel_id=${channelId}
  union select high_actor_id from public.messaging_dm_pairs where channel_id=${channelId}
  union select actor_id from public.messaging_group_grants
    where channel_id=${channelId} and revoked_at is null`;

/**
 * Whether `actor` wants email about conversation `channel`: it is not
 * hidden, and its notification preference is All (the default until they
 * choose). Mentions are not emailed.
 */
const wantsConversationEmail = (channel: SQL, actor: SQL) =>
  sql`coalesce((select s.notification_level='all' and not s.hidden
    from public.messaging_actor_states s
    where s.channel_id=${channel} and s.actor_id=${actor}),true)`;

/**
 * Owes each other member of the conversation an unread-messages email, in
 * the send's transaction (ADR 0144): one queued per member, pushed back to a
 * quiet time after this message, never past the longest wait after the
 * first. A member who stopped all notification email, or this
 * conversation's, is owed none.
 */
export async function oweUnreadMessageEmails(
  tx: Tx,
  sent: {
    readonly channelId: string;
    readonly authorActorId: string;
    readonly at: string;
  },
): Promise<void> {
  const at = sql`${sent.at}::timestamptz`;
  const channel = sql`${sent.channelId}`;
  const members = await query(
    tx,
    z.object({ user_id: z.string() }),
    sql`select u.id as user_id from (${membersOf(channel)}) m
      join public.actors a on a.id=m.actor_id
      join public.users u on u.id=a.user_id and u.deleted_at is null
      where m.actor_id<>${sent.authorActorId}
        and ${wantsConversationEmail(channel, sql`m.actor_id`)}
        and ${emailsMember(sql`u.id`)}`,
  );
  if (members.length === 0) return;
  const jobs = JSON.stringify(
    members.map((member) => ({ id: createId(), user_id: member.user_id })),
  );
  await run(
    tx,
    sql`insert into messaging_unread_emails(id,user_id,first_owed_at,state,attempts,next_attempt_at,created_at)
    select j.id,j.user_id,${at},'queued',0,${at}+${UNREAD_EMAIL_QUIET_MS}*interval '1 millisecond',${at}
    from jsonb_to_recordset(${jobs}::text::jsonb) as j(id text,user_id text)
    on conflict (user_id) where state='queued' do update set next_attempt_at=least(
      greatest(messaging_unread_emails.next_attempt_at,excluded.next_attempt_at),
      messaging_unread_emails.first_owed_at+${UNREAD_EMAIL_LONGEST_WAIT_MS}*interval '1 millisecond')`,
  );
}

/** The unread-messages email queue's store (ADR 0144), on the shared mail recipe. */
export function messagingUnreadEmailOperations({
  database,
  eventSink,
}: {
  readonly database: TxSource;
  readonly eventSink?: DatabaseEventSink | undefined;
}) {
  return {
    claimMessagingUnreadEmails: (
      input: MailJobClaimInput,
    ): Promise<readonly MessagingUnreadEmailClaim[]> =>
      instrumented(eventSink, 'claimMessagingUnreadEmails', async () =>
        (await queue.claimDue(database, input, sql`id, attempts`)).map(
          ({ row, token }) => ({ ...claimRow.parse(row), token }),
        ),
      ),
    /**
     * How many of the member's conversations hold a message from someone
     * else they have not read, that they still belong to and still want email
     * about. None cancels the job; so does a member gone, unverified or with
     * all notification email stopped.
     */
    readMessagingUnreadEmailDelivery: (
      id: string,
    ): Promise<MessagingUnreadEmailDelivery> =>
      instrumented(eventSink, 'readMessagingUnreadEmailDelivery', async () => {
        const [member] = await query(
          database,
          z.object({
            user_id: z.string(),
            actor_id: z.string().nullable(),
            email: z.string().nullable(),
            verified: z.boolean().nullable(),
            emails: z.boolean(),
          }),
          sql`select j.user_id,a.id as actor_id,u.email,u.email_verified as verified,
              ${emailsMember(sql`j.user_id`)} as emails
            from messaging_unread_emails j
            left join users u on u.id=j.user_id and u.deleted_at is null
            left join actors a on a.user_id=u.id
            where j.id=${id}`,
        );
        if (!member) throw createAppError('NOT_FOUND');
        if (!member.email || !member.verified || !member.actor_id)
          return { kind: 'cancel', errorCode: 'recipient-gone' };
        if (!member.emails) return { kind: 'cancel', errorCode: 'not-owed' };
        const actor = sql`${member.actor_id}`;
        const [count] = await rowsOf<{ n: number | string }>(
          database,
          sql`select count(*) as n from (
              select channel_id from public.messaging_dm_pairs where ${actor} in (low_actor_id,high_actor_id)
              union select channel_id from public.messaging_group_grants
                where actor_id=${actor} and revoked_at is null) c
            where ${wantsConversationEmail(sql`c.channel_id`, actor)}
              and exists(select 1 from public.messaging_messages m
                where m.channel_id=c.channel_id and m.author_actor_id<>${actor}
                  and m.removed_at is null
                  and m.sequence > coalesce((select s.read_sequence from public.messaging_actor_states s
                    where s.channel_id=c.channel_id and s.actor_id=${actor}),0))`,
        );
        const conversations = Number(count?.n ?? 0);
        return conversations === 0
          ? { kind: 'cancel', errorCode: 'not-owed' }
          : {
              kind: 'send',
              to: member.email,
              userId: member.user_id,
              actorId: member.actor_id,
              conversations,
            };
      }),
    settleMessagingUnreadEmail: (input: {
      readonly id: string;
      readonly token: string;
      readonly outcome: MessagingUnreadEmailOutcome;
    }): Promise<boolean> =>
      instrumented(eventSink, 'settleMessagingUnreadEmail', () =>
        queue.settle(database, input),
      ),
    /**
     * Waits again while the member is in Daisy. When a later message queued
     * another meanwhile, this one ends: the queued one covers it.
     */
    postponeMessagingUnreadEmail: (input: {
      readonly id: string;
      readonly token: string;
      readonly until: string;
    }): Promise<boolean> =>
      instrumented(eventSink, 'postponeMessagingUnreadEmail', () =>
        // A job owed while this one was held can take the one queued place
        // first; the second attempt then sees it and joins it.
        retriedOnceIfQueuedMeanwhile(() =>
          inTransaction(database, async (tx) => {
            const [next] = await query(
              tx,
              z.object({ id: z.string() }),
              sql`select q.id from messaging_unread_emails q
              join messaging_unread_emails j on j.user_id=q.user_id and j.id=${input.id}
              where q.state='queued' for update of q`,
            );
            return next
              ? queue.settle(tx, {
                  id: input.id,
                  token: input.token,
                  outcome: { kind: 'cancelled', errorCode: 'not-owed' },
                })
              : queue.postpone(tx, input);
          }),
        ),
      ),
    /** Terminal jobs only, 30 days after they ended. */
    purgeExpiredMessagingUnreadEmails: (batch: RetentionBatch) =>
      instrumented(eventSink, 'purgeExpiredMessagingUnreadEmails', () =>
        deleteExpiredBatch(
          database,
          {
            table: messagingUnreadEmails,
            key: messagingUnreadEmails.id,
            at: messagingUnreadEmails.completedAt,
          },
          batch,
        ),
      ),
  };
}
