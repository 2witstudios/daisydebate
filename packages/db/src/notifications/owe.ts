import {
  buildUserInboxTopic,
  isEmailedNotificationKind,
  subjectOf,
  type NotificationKind,
  type NotificationSubjectKind,
} from '@daisy/protocol';
import { sql, type SQL } from 'drizzle-orm';
import type { AuthorizationTransaction } from '../authorization';
import { appendOutboxEvent } from '../outbox';
import { rowsOf } from '../raw-rows';
import { wants } from './preferences';

/** One member a producer owes a notification, and who it is about. */
export type NotificationRecipient = {
  readonly userId: string;
  /** The account it is about (the challenger, the host), or null when none is. */
  readonly about: string | null;
};

/** One event a producer just recorded, owed to each of its recipients (ADR 0143). */
export type OwedNotifications = {
  readonly kind: NotificationKind;
  /** The id of the subject the kind names: a Round, an invitation, a challenge. */
  readonly subjectId: string;
  readonly recipients: readonly NotificationRecipient[];
  readonly at: string;
  readonly nextId: () => string;
  /**
   * Whether an emailed kind is also owed by email now. A producer withholds it
   * to keep its own rate (one invitation email an hour per Room and member).
   */
  readonly email?: boolean | undefined;
};

/** The stored column that names a subject of this kind. */
const subjectColumn = (subject: NotificationSubjectKind): SQL => {
  switch (subject) {
    case 'round':
      return sql.raw('round_id');
    case 'room_invitation':
      return sql.raw('room_invitation_id');
    case 'challenge':
      return sql.raw('challenge_id');
  }
};

/**
 * The one writer every producer calls, in its own transaction: one bulk
 * insert, one content-free `user:inbox` signal per row written, and an email
 * job per row when the kind is emailed and the member's email channel is on
 * (read now; the job re-reads it at send time). A recipient already told of
 * this subject writes nothing. A row is written even with the in-app channel
 * off: the inbox read leaves it out, so a preference suppresses delivery
 * without deleting truth. A recipient with no live account writes nothing.
 * Returns the rows written.
 */
export async function oweNotifications(
  tx: AuthorizationTransaction,
  owed: OwedNotifications,
): Promise<number> {
  if (owed.recipients.length === 0) return 0;
  const rows = JSON.stringify(
    owed.recipients.map((recipient) => ({
      id: owed.nextId(),
      user_id: recipient.userId,
      actor_id: recipient.about,
    })),
  );
  const column = subjectColumn(subjectOf(owed.kind));
  const written = await rowsOf<{
    id: string;
    user_id: string;
    actor_id: string;
  }>(
    tx,
    sql`with w as (
        insert into notifications(id,user_id,kind,${column},actor_id,created_at,surfaced_at)
        select w.id,w.user_id,${owed.kind},${owed.subjectId},w.actor_id,${owed.at}::timestamptz,${owed.at}::timestamptz
        from jsonb_to_recordset(${rows}::text::jsonb) as w(id text,user_id text,actor_id text)
        join users u on u.id=w.user_id and u.deleted_at is null
        on conflict do nothing returning id,user_id)
      select w.id,w.user_id,a.id as actor_id from w join actors a on a.user_id=w.user_id
      order by w.id`,
  );
  for (const row of written)
    await appendOutboxEvent(tx, {
      topic: buildUserInboxTopic(row.actor_id),
      kind: 'user.notification-delivered',
      version: 1,
      payload: {
        entityVersion: 1,
        kind: 'user.notification-delivered',
        ids: [row.id],
        notificationType: owed.kind,
        occurredAt: owed.at,
      },
    });
  if (
    written.length === 0 ||
    owed.email === false ||
    !isEmailedNotificationKind(owed.kind)
  )
    return written.length;
  const jobs = JSON.stringify(
    written.map((row) => ({
      id: owed.nextId(),
      notification_id: row.id,
      user_id: row.user_id,
    })),
  );
  await tx.execute(sql`insert into notification_emails(id,notification_id,user_id,kind,state,attempts,next_attempt_at,created_at)
    select j.id,j.notification_id,j.user_id,${owed.kind},'queued',0,${owed.at}::timestamptz,${owed.at}::timestamptz
    from jsonb_to_recordset(${jobs}::text::jsonb) as j(id text,notification_id text,user_id text)
    where ${wants(owed.kind, 'email', sql`j.user_id`)}`);
  return written.length;
}
