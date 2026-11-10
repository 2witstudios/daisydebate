import {
  buildUserInboxTopic,
  type CompetitionType,
  type EmailedNotificationKind,
  type NotificationKind,
  type RatingLadder,
  type RoomSeatKind,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { AuthorizationTransaction } from '../authorization';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { appendOutboxEvent } from '../outbox';
import { rowsOf } from '../raw-rows';
import { wants } from './preferences';

/** What a producer owes one member, in its own transaction (ADR 0124). */
export type OwedNotification = {
  /** The notification's id; also its email job's id when one is owed. */
  readonly id: string;
  readonly emailJobId: string;
  readonly recipient: { readonly userId: string; readonly actorId: string };
  /** Who it is about: the inviting host or the challenger. */
  readonly actorId: string;
  readonly at: string;
} & (
  | {
      readonly kind: 'room_invitation';
      readonly roomInvitationId: string;
    }
  | { readonly kind: 'challenge_received'; readonly challengeId: string }
);

/**
 * Writes one notification for an event a producer just recorded, in the
 * producer's transaction: the inbox row, one content-free `user:inbox`
 * signal, and an email job when the member's email channel for the kind is
 * on (read now; the job re-reads it at send time). The row is written even
 * when the in-app channel is off: the inbox read leaves it out, so a
 * preference suppresses delivery without deleting truth. A repeat of the
 * same subject writes nothing.
 */
export async function oweNotification(
  tx: AuthorizationTransaction,
  owed: OwedNotification,
): Promise<void> {
  const subject =
    owed.kind === 'room_invitation'
      ? { invitation: owed.roomInvitationId, challenge: null }
      : { invitation: null, challenge: owed.challengeId };
  const written = await rowsOf<{ id: string }>(
    tx,
    sql`insert into notifications(id,user_id,kind,room_invitation_id,challenge_id,actor_id,created_at)
      values(${owed.id},${owed.recipient.userId},${owed.kind},${subject.invitation},${subject.challenge},${owed.actorId},${owed.at}::timestamptz)
      on conflict do nothing returning id`,
  );
  if (written.length === 0) return;
  await appendOutboxEvent(tx, {
    topic: buildUserInboxTopic(owed.recipient.actorId),
    kind: 'user.notification-delivered',
    version: 1,
    payload: {
      entityVersion: 1,
      kind: 'user.notification-delivered',
      ids: [owed.id],
      notificationType: owed.kind,
      occurredAt: owed.at,
    },
  });
  await tx.execute(sql`insert into notification_emails(id,notification_id,user_id,kind,state,attempts,next_attempt_at,created_at)
    select ${owed.emailJobId},${owed.id},u.id,${owed.kind},'queued',0,${owed.at}::timestamptz,${owed.at}::timestamptz
    from users u where u.id=${owed.recipient.userId} and u.deleted_at is null
      and ${wants(owed.kind satisfies EmailedNotificationKind, 'email', sql`u.id`)}`);
}

/** One stored notification as the inbox reads it, with the facts its words need. */
export type InboxRow = {
  readonly id: string;
  readonly readAt: string | null;
  readonly createdAt: string;
} & (
  | {
      readonly kind: 'followed_debater_live';
      readonly roundId: string;
      readonly debater: string | null;
    }
  | { readonly kind: 'recording_ready'; readonly roundId: string }
  | {
      readonly kind: 'room_invitation';
      readonly roomId: string;
      readonly seat: RoomSeatKind;
      readonly host: string | null;
    }
  | {
      readonly kind: 'challenge_received';
      readonly challenger: string | null;
      readonly mode: CompetitionType;
      readonly format: RatingLadder;
    }
);

type FlatRow = {
  id: string;
  kind: NotificationKind;
  roundId: string | null;
  roomId: string | null;
  seat: RoomSeatKind | null;
  about: string | null;
  mode: CompetitionType | null;
  format: RatingLadder | null;
  readAt: string | null;
  createdAt: string;
};

const inboxRow = (row: FlatRow): InboxRow => {
  const base = { id: row.id, readAt: row.readAt, createdAt: row.createdAt };
  switch (row.kind) {
    case 'followed_debater_live':
      return {
        ...base,
        kind: row.kind,
        roundId: row.roundId!,
        debater: row.about,
      };
    case 'recording_ready':
      return { ...base, kind: row.kind, roundId: row.roundId! };
    case 'room_invitation':
      return {
        ...base,
        kind: row.kind,
        roomId: row.roomId!,
        seat: row.seat!,
        host: row.about,
      };
    case 'challenge_received':
      return {
        ...base,
        kind: row.kind,
        challenger: row.about,
        mode: row.mode!,
        format: row.format!,
      };
  }
};

const iso = (column: string) =>
  sql.raw(
    `to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  );

/** The inbox: reads, read state and retention, over every kind. */
export const notificationInboxOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /**
   * Newest first, each only while the thing it names still stands and the
   * member's in-app channel for its kind is on.
   */
  readNotifications(input: {
    readonly userId: string;
    readonly unreadOnly: boolean;
    readonly limit: number;
    readonly now: string;
  }) {
    return instrumented(eventSink, 'readNotifications', async () => {
      const now = sql`${input.now}::timestamptz`;
      const standing = sql`(
        (n.kind='followed_debater_live' and r.visibility='public' and u.username is not null
          and exists(select 1 from broadcasts b where b.round_id=n.round_id and b.completed_at is null and b.stopped_at is null))
        or (n.kind='recording_ready' and rc.status='ready')
        or (n.kind='room_invitation' and i.state='pending' and i.expires_at>${now}
          and ${wants('room_invitation', 'in_app', sql`n.user_id`)})
        or (n.kind='challenge_received' and c.room_id is null and c.expires_at>${now}
          and ${wants('challenge_received', 'in_app', sql`n.user_id`)}))`;
      const from = sql`from notifications n
        left join rounds r on r.id=n.round_id
        left join actors a on a.id=n.actor_id
        left join users u on u.id=a.user_id and u.deleted_at is null
        left join recordings rc on rc.round_id=n.round_id
        left join room_invitations i on i.id=n.room_invitation_id
        left join challenges c on c.id=n.challenge_id
        where n.user_id=${input.userId} and ${standing}`;
      const rows = await rowsOf<FlatRow>(
        database,
        sql`select n.id,n.kind,n.round_id as "roundId",i.room_id as "roomId",i.seat,
            u.username as about,c.mode,c.format_id as format,
            ${iso('n.read_at')} as "readAt",${iso('n.created_at')} as "createdAt"
          ${from} ${input.unreadOnly ? sql`and n.read_at is null` : sql``}
          order by n.created_at desc,n.id desc limit ${input.limit}`,
      );
      const [count] = await rowsOf<{ unread: number | string }>(
        database,
        sql`select count(*) as unread ${from} and n.read_at is null`,
      );
      return { rows: rows.map(inboxRow), unread: Number(count?.unread ?? 0) };
    });
  },
  /** Marks one, or every, of this account's own; another's id changes nothing. */
  markNotificationsRead(input: {
    readonly userId: string;
    readonly notificationId: string | null;
    readonly at: string;
  }) {
    return instrumented(eventSink, 'markNotificationsRead', async () => {
      const one =
        input.notificationId === null
          ? sql``
          : sql`and id=${input.notificationId}`;
      await database.execute(sql`update notifications set read_at=${input.at}::timestamptz
        where user_id=${input.userId} and read_at is null ${one}`);
    });
  },
  /** The retention sweep: a notification goes 90 days after it is read. */
  purgeReadNotifications(input: {
    readonly before: string;
    readonly limit: number;
  }) {
    return instrumented(eventSink, 'purgeReadNotifications', async () => {
      const gone = await rowsOf(
        database,
        sql`delete from notifications where id in (select id from notifications
            where read_at < ${input.before}::timestamptz limit ${input.limit})
          returning id`,
      );
      return gone.length;
    });
  },
});
