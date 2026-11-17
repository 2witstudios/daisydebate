import {
  buildUserInboxTopic,
  type CompetitionType,
  type NotificationKind,
  type RatingLadder,
  type RoomSeatKind,
} from '@daisy/protocol';
import { sql, type SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { appendOutboxEvent } from '../outbox';
import { rowsOf } from '../raw-rows';
import { wants } from './preferences';
import { notificationStands, standingJoins } from './standing';

/** A position in the inbox, newest first: the last row a page showed. */
export type InboxCursor = { readonly surfacedAt: string; readonly id: string };

/** One stored notification as the inbox reads it, with the facts its words need. */
export type InboxRow = {
  readonly id: string;
  readonly readAt: string | null;
  /** When it last reached the member: written, or brought back unread. */
  readonly surfacedAt: string;
} & (
  | {
      readonly kind: 'followed_debater_live';
      readonly roundId: string;
      readonly debater: string | null;
    }
  | { readonly kind: 'recording_ready'; readonly roundId: string }
  | { readonly kind: 'round_started'; readonly roundId: string }
  | {
      readonly kind: 'round_decision_released';
      readonly roundId: string;
      /** Who the member debated (a judge: the affirmative), if a live account. */
      readonly opponent: string | null;
    }
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
  | {
      readonly kind: 'challenge_accepted';
      readonly roomId: string;
      /** Who accepted, or null once their account is gone. */
      readonly opponent: string | null;
    }
  | {
      readonly kind: 'friend_request_received' | 'friend_request_accepted';
      /** The other member, or null once their account is gone. */
      readonly friend: string | null;
    }
);

type FlatRow = {
  id: string;
  kind: NotificationKind;
  roundId: string | null;
  roomId: string | null;
  challengeRoomId: string | null;
  seat: RoomSeatKind | null;
  about: string | null;
  mode: CompetitionType | null;
  format: RatingLadder | null;
  readAt: string | null;
  surfacedAt: string;
};

const inboxRow = (row: FlatRow): InboxRow => {
  const base = {
    id: row.id,
    readAt: row.readAt,
    surfacedAt: row.surfacedAt,
  };
  switch (row.kind) {
    case 'followed_debater_live':
      return {
        ...base,
        kind: row.kind,
        roundId: row.roundId!,
        debater: row.about,
      };
    case 'recording_ready':
    case 'round_started':
      return { ...base, kind: row.kind, roundId: row.roundId! };
    case 'round_decision_released':
      return {
        ...base,
        kind: row.kind,
        roundId: row.roundId!,
        opponent: row.about,
      };
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
    case 'challenge_accepted':
      return {
        ...base,
        kind: row.kind,
        roomId: row.challengeRoomId!,
        opponent: row.about,
      };
    case 'friend_request_received':
    case 'friend_request_accepted':
      return { ...base, kind: row.kind, friend: row.about };
  }
};

const iso = (column: string) =>
  sql.raw(
    `to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  );

/**
 * Stored notifications as the inbox and the digest read them, newest first:
 * `where` is over `n` and the standing joins.
 */
export const readInboxRows = async (
  database: Pick<BunSQLDatabase, 'execute'>,
  input: { readonly where: SQL; readonly limit: number },
): Promise<readonly InboxRow[]> =>
  (
    await rowsOf<FlatRow>(
      database,
      sql`select n.id,n.kind,n.round_id as "roundId",i.room_id as "roomId",
          c.room_id as "challengeRoomId",i.seat,
          u.username as about,c.mode,c.format_id as format,
          ${iso('n.read_at')} as "readAt",${iso('n.surfaced_at')} as "surfacedAt"
        from notifications n ${standingJoins} where ${input.where}
        order by n.surfaced_at desc,n.id desc limit ${input.limit}`,
    )
  ).map(inboxRow);

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
    /** The last row of the page before; null for the first page. */
    readonly after: InboxCursor | null;
  }): Promise<{
    readonly rows: readonly InboxRow[];
    readonly unread: number;
    /** Where the next page starts, or null when this is the last. */
    readonly next: InboxCursor | null;
  }> {
    return instrumented(eventSink, 'readNotifications', async () => {
      const shown = sql`n.user_id=${input.userId}
        and ${notificationStands(sql`${input.now}::timestamptz`)}
        and ${wants(sql`n.kind`, 'in_app', sql`n.user_id`)}`;
      const after =
        input.after === null
          ? sql``
          : sql`and (n.surfaced_at,n.id) < (${input.after.surfacedAt}::timestamptz,${input.after.id})`;
      const rows = await readInboxRows(database, {
        where: sql`${shown} ${input.unreadOnly ? sql`and n.read_at is null` : sql``} ${after}`,
        limit: input.limit + 1,
      });
      const [count] = await rowsOf<{ unread: number | string }>(
        database,
        sql`select count(*) as unread from notifications n ${standingJoins}
          where ${shown} and n.read_at is null`,
      );
      const page = rows.slice(0, input.limit);
      const last = page.at(-1);
      return {
        rows: page,
        unread: Number(count?.unread ?? 0),
        next:
          rows.length > input.limit && last
            ? { surfacedAt: last.surfacedAt, id: last.id }
            : null,
      };
    });
  },
  /**
   * Marks some, or every, of this account's own; another's id changes
   * nothing. When anything changed, every tab of the member's hears it.
   */
  markNotificationsRead(input: {
    readonly userId: string;
    readonly notificationIds: readonly string[] | 'all';
    readonly at: string;
  }) {
    return instrumented(eventSink, 'markNotificationsRead', () =>
      database.transaction(async (tx) => {
        const some =
          input.notificationIds === 'all'
            ? sql``
            : sql`and id in (select jsonb_array_elements_text(${JSON.stringify(input.notificationIds)}::text::jsonb))`;
        const changed = await rowsOf(
          tx,
          sql`update notifications set read_at=${input.at}::timestamptz
            where user_id=${input.userId} and read_at is null ${some} returning id`,
        );
        if (changed.length === 0) return;
        const [actor] = await rowsOf<{ id: string }>(
          tx,
          sql`select id from actors where user_id=${input.userId}`,
        );
        if (actor)
          await appendOutboxEvent(tx, {
            topic: buildUserInboxTopic(actor.id),
            kind: 'user.notifications-read',
            version: 1,
            payload: { kind: 'user.notifications-read' },
          });
      }),
    );
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
