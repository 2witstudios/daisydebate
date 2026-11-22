import { buildUserInboxTopic } from '@daisy/protocol/topics';
import {
  isEmailedNotificationKind,
  subjectOf,
  type NotificationKind,
  type SubjectOf,
} from '@daisy/protocol/notifications';
import { sql } from 'drizzle-orm';
import { appendOutboxEvents } from '../outbox';
import { query } from '../raw-rows';
import { notificationSubjectColumns } from '../schema/notifications';
import { oweDigests } from './digests';
import type { Tx } from '../tx';
import { z } from 'zod';

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

/** One event a producer just recorded, owed to each of its recipients (ADR 0144). */
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
  tx: Tx,
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
  const written = await query(
    tx,
    z.object({ id: z.string(), user_id: z.string(), actor_id: z.string() }),
    sql`with w as (
        insert into notifications(id,user_id,kind,${subjectNames},actor_id,created_at,surfaced_at)
        select w.id,w.user_id,${owed.kind},${subjectValues},w.actor_id,${owed.at}::timestamptz,${owed.at}::timestamptz
        from jsonb_to_recordset(${rows}::text::jsonb) as w(id text,user_id text,actor_id text)
        join users u on u.id=w.user_id and u.deleted_at is null
        on conflict do nothing returning id,user_id)
      select w.id,w.user_id,a.id as actor_id from w join actors a on a.user_id=w.user_id
      order by w.id`,
  );
  await tellMembers(tx, {
    kind: owed.kind,
    rows: written,
    at: owed.at,
    nextId: owed.nextId,
  });
  return written.length;
}

/**
 * What every written or resurfaced row owes its member: one content-free
 * `user:inbox` signal, and for an emailed kind a place in their digest.
 */
async function tellMembers(
  tx: Tx,
  told: {
    readonly kind: NotificationKind;
    readonly rows: readonly {
      readonly id: string;
      readonly user_id: string;
      readonly actor_id: string;
    }[];
    readonly at: string;
    readonly nextId: () => string;
  },
): Promise<void> {
  // One insert for the whole event: a fan-out to many followers stays one
  // bounded statement, not one per member.
  await appendOutboxEvents(
    tx,
    told.rows.map((row) => ({
      topic: buildUserInboxTopic(row.actor_id),
      kind: 'user.notification-delivered',
      version: 1,
      payload: {
        entityVersion: 1,
        kind: 'user.notification-delivered',
        ids: [row.id],
        notificationType: told.kind,
        occurredAt: told.at,
      },
    })),
  );
  if (isEmailedNotificationKind(told.kind))
    await oweDigests(tx, {
      kind: told.kind,
      rows: told.rows.map((row) => ({ id: row.id, userId: row.user_id })),
      at: told.at,
      nextId: told.nextId,
    });
}

/**
 * Brings members' existing notifications of one subject back to them, in the
 * producer's transaction (ADR 0144): something new about it happened (a
 * Round's analysis is ready beside its decision). Each comes back unread at
 * the top of the inbox and is told like a new one. Returns the rows moved.
 */
export async function resurfaceNotifications<K extends NotificationKind>(
  tx: Tx,
  owed: {
    readonly kind: K;
    readonly subject: NotificationSubjectIds<K>;
    readonly userIds: readonly string[];
    readonly at: string;
    readonly nextId: () => string;
  },
): Promise<number> {
  if (owed.userIds.length === 0) return 0;
  const columns: readonly string[] =
    notificationSubjectColumns[subjectOf(owed.kind)];
  const ids = owed.subject as Readonly<Record<string, string>>;
  const names = sql.join(
    columns.map((column) => sql`n.${sql.raw(column)}=${ids[column]}`),
    sql` and `,
  );
  const users = JSON.stringify(owed.userIds);
  const moved = await query(
    tx,
    z.object({ id: z.string(), user_id: z.string(), actor_id: z.string() }),
    sql`with m as (
        update notifications n set surfaced_at=${owed.at}::timestamptz,read_at=null
        where n.kind=${owed.kind} and ${names}
          and n.user_id in (select jsonb_array_elements_text(${users}::text::jsonb))
        returning n.id,n.user_id)
      select m.id,m.user_id,a.id as actor_id from m join actors a on a.user_id=m.user_id
      order by m.id`,
  );
  await tellMembers(tx, {
    kind: owed.kind,
    rows: moved,
    at: owed.at,
    nextId: owed.nextId,
  });
  return moved.length;
}
