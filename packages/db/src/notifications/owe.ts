import {
  buildUserInboxTopic,
  isEmailedNotificationKind,
  subjectOf,
  type NotificationKind,
  type SubjectOf,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { AuthorizationTransaction } from '../authorization';
import { appendOutboxEvent } from '../outbox';
import { rowsOf } from '../raw-rows';
import { notificationSubjectColumns } from '../schema/notifications';
import { oweDigests } from './digests';

type SubjectColumns = typeof notificationSubjectColumns;

/** The stored ids that name a kind's subject, by column: `{ round_id }`. */
export type NotificationSubjectIds<K extends NotificationKind> = {
  readonly [C in SubjectColumns[SubjectOf<K>][number]]: string;
};

/** One member a producer owes a notification, and who it is about. */
export type NotificationRecipient = {
  readonly userId: string;
  /** The account it is about (the challenger, the host), or null when none is. */
  readonly about: string | null;
};

/** One event a producer just recorded, owed to each of its recipients (ADR 0143). */
export type OwedNotifications<K extends NotificationKind> = {
  readonly kind: K;
  /** The subject the kind names: a Round, an invitation, a challenge, a friendship. */
  readonly subject: NotificationSubjectIds<K>;
  readonly recipients: readonly NotificationRecipient[];
  readonly at: string;
  readonly nextId: () => string;
};

/**
 * The one writer every producer calls, in its own transaction: one bulk
 * insert, one content-free `user:inbox` signal per row written, and, for an
 * emailed kind, each row gathered into its member's digest (which re-reads
 * every choice at send time). A recipient already told of
 * this subject writes nothing. A row is written even with the in-app channel
 * off: the inbox read leaves it out, so a preference suppresses delivery
 * without deleting truth. A recipient with no live account writes nothing.
 * Returns the rows written.
 */
export async function oweNotifications<K extends NotificationKind>(
  tx: AuthorizationTransaction,
  owed: OwedNotifications<K>,
): Promise<number> {
  if (owed.recipients.length === 0) return 0;
  const rows = JSON.stringify(
    owed.recipients.map((recipient) => ({
      id: owed.nextId(),
      user_id: recipient.userId,
      actor_id: recipient.about,
    })),
  );
  const columns: readonly string[] =
    notificationSubjectColumns[subjectOf(owed.kind)];
  const ids = owed.subject as Readonly<Record<string, string>>;
  const subjectNames = sql.raw(columns.join(','));
  const subjectValues = sql.join(
    columns.map((column) => sql`${ids[column]}`),
    sql`,`,
  );
  const written = await rowsOf<{
    id: string;
    user_id: string;
    actor_id: string;
  }>(
    tx,
    sql`with w as (
        insert into notifications(id,user_id,kind,${subjectNames},actor_id,created_at,surfaced_at)
        select w.id,w.user_id,${owed.kind},${subjectValues},w.actor_id,${owed.at}::timestamptz,${owed.at}::timestamptz
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
  if (isEmailedNotificationKind(owed.kind))
    await oweDigests(tx, {
      kind: owed.kind,
      rows: written.map((row) => ({ id: row.id, userId: row.user_id })),
      at: owed.at,
      nextId: owed.nextId,
    });
  return written.length;
}
