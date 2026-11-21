import { createAppError } from '@daisy/errors';
import {
  buildUserInboxTopic,
  type CompetitionType,
  type NotificationKind,
  type RatingStyle,
  type SeatKind,
  type TournamentNotificationKind,
  seatKindSchema,
  competitionTypes,
  notificationKinds,
} from '@daisy/protocol';
import { maskEmail } from '@daisy/protocol/media-release';
import { sql, type SQL } from 'drizzle-orm';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { appendOutboxEvent } from '../outbox';
import { postgresInt8, query } from '../raw-rows';
import { wants } from './preferences';
import {
  notificationStands,
  standingJoins,
  tournamentStanding,
} from './standing';
import {
  standingTournamentNotifications,
  type TournamentInboxAccess,
  type TournamentNotificationFacts,
} from './tournament-inbox';
import { inTransaction, type Tx, type TxSource } from '../tx';
import { z } from 'zod';

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
      readonly seat: SeatKind;
      readonly host: string | null;
    }
  | {
      readonly kind: 'challenge_received';
      readonly challenger: string | null;
      readonly mode: CompetitionType;
      readonly format: RatingStyle;
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
  | {
      readonly kind: 'dm_request';
      /** The DM the request opened, where it is answered. */
      readonly channelId: string;
      /** Who asked, or null once their account is gone. */
      readonly from: string | null;
    }
  | (TournamentNotificationFacts & {
      readonly kind: TournamentNotificationKind;
    })
  | {
      readonly kind: 'media_release_requested';
      /** The parent's address, masked: the minor typed it. */
      readonly recipient: string;
      readonly expiresAt: string;
    }
  | {
      readonly kind:
        | 'media_release_declined'
        | 'media_release_signed'
        | 'media_release_club_confirmed';
    }
  | {
      readonly kind: 'media_release_withdrawn';
      /** The member's own release, or (to their coach) a student's. */
      readonly own: boolean;
      readonly minor: string | null;
    }
  | {
      readonly kind: 'media_release_club_asked';
      readonly student: string | null;
      readonly clubHandle: string;
    }
);

type FlatRow = {
  id: string;
  kind: NotificationKind;
  roundId: string | null;
  roomId: string | null;
  challengeRoomId: string | null;
  seat: SeatKind | null;
  about: string | null;
  mode: CompetitionType | null;
  format: RatingStyle | null;
  recipientEmail: string | null;
  requestExpiresAt: string | null;
  minor: string | null;
  ownRelease: boolean | null;
  clubHandle: string | null;
  dmChannelId: string | null;
  readAt: string | null;
  surfacedAt: string;
};

const requiredInboxField = <Field extends keyof FlatRow>(
  row: FlatRow,
  field: Field,
) => {
  const value = row[field];
  if (value === null)
    throw createAppError('INVARIANT', 'Notification subject facts are missing');
  return value;
};

const inboxRow = (
  row: FlatRow,
  tournament: ReadonlyMap<string, TournamentNotificationFacts>,
): InboxRow => {
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
        roundId: requiredInboxField(row, 'roundId'),
        debater: row.about,
      };
    case 'recording_ready':
    case 'round_started':
      return {
        ...base,
        kind: row.kind,
        roundId: requiredInboxField(row, 'roundId'),
      };
    case 'round_decision_released':
      return {
        ...base,
        kind: row.kind,
        roundId: requiredInboxField(row, 'roundId'),
        opponent: row.about,
      };
    case 'room_invitation':
      return {
        ...base,
        kind: row.kind,
        roomId: requiredInboxField(row, 'roomId'),
        seat: requiredInboxField(row, 'seat'),
        host: row.about,
      };
    case 'challenge_received':
      return {
        ...base,
        kind: row.kind,
        challenger: row.about,
        mode: requiredInboxField(row, 'mode'),
        format: requiredInboxField(row, 'format'),
      };
    case 'challenge_accepted':
      return {
        ...base,
        kind: row.kind,
        roomId: requiredInboxField(row, 'challengeRoomId'),
        opponent: row.about,
      };
    case 'friend_request_received':
    case 'friend_request_accepted':
      return { ...base, kind: row.kind, friend: row.about };
    case 'dm_request':
      return {
        ...base,
        kind: row.kind,
        channelId: requiredInboxField(row, 'dmChannelId'),
        from: row.about,
      };
    case 'media_release_requested':
      return {
        ...base,
        kind: row.kind,
        recipient: maskEmail(requiredInboxField(row, 'recipientEmail')),
        expiresAt: requiredInboxField(row, 'requestExpiresAt'),
      };
    case 'media_release_declined':
    case 'media_release_signed':
    case 'media_release_club_confirmed':
      return { ...base, kind: row.kind };
    case 'media_release_withdrawn':
      return {
        ...base,
        kind: row.kind,
        own: row.ownRelease === true,
        minor: row.minor,
      };
    case 'media_release_club_asked':
      return {
        ...base,
        kind: row.kind,
        student: row.about,
        clubHandle: requiredInboxField(row, 'clubHandle'),
      };
    case 'judge_assigned':
    case 'judge_replaced':
    case 'judge_unassigned':
    case 'tournament_draw_changed':
    case 'tournament_room_ready':
    case 'tournament_results_released': {
      // Standing named it, so Tab's own read supplied its facts (NTF-15).
      const facts = tournament.get(row.id);
      if (!facts) throw new Error('A standing tournament row has no facts');
      return { ...base, ...facts, kind: row.kind };
    }
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
  database: Tx,
  input: {
    readonly where: SQL;
    readonly limit: number;
    /** Tab's standing tournament rows and their facts; none for a digest. */
    readonly tournament?: ReadonlyMap<string, TournamentNotificationFacts>;
  },
): Promise<readonly InboxRow[]> =>
  (
    await query(
      database,
      z.object({
        id: z.string(),
        kind: z.enum(notificationKinds),
        roundId: z.string().nullable(),
        roomId: z.string().nullable(),
        challengeRoomId: z.string().nullable(),
        seat: seatKindSchema.nullable(),
        about: z.string().nullable(),
        mode: z.enum(competitionTypes).nullable(),
        format: z.literal('freestyle').nullable(),
        recipientEmail: z.string().nullable(),
        requestExpiresAt: z.string().nullable(),
        minor: z.string().nullable(),
        ownRelease: z.boolean().nullable(),
        clubHandle: z.string().nullable(),
        dmChannelId: z.string().nullable(),
        readAt: z.string().nullable(),
        surfacedAt: z.string(),
      }),
      sql`select n.id,n.kind,n.round_id as "roundId",i.room_id as "roomId",
          c.room_id as "challengeRoomId",i.seat,
          u.username as about,c.mode,c.format_id as format,
          mrq.recipient_email as "recipientEmail",
          ${iso('mrq.expires_at')} as "requestExpiresAt",
          mru.username as minor,(mr.user_id=n.user_id) as "ownRelease",
          mco.handle as "clubHandle",n.dm_channel_id as "dmChannelId",
          ${iso('n.read_at')} as "readAt",${iso('n.surfaced_at')} as "surfacedAt"
        from notifications n ${standingJoins} where ${input.where}
        order by n.surfaced_at desc,n.id desc limit ${input.limit}`,
    )
  ).map((row) => inboxRow(row, input.tournament ?? new Map()));

/** The inbox: reads, read state and retention, over every kind. */
export const notificationInboxOperations = ({
  database,
  eventSink,
}: {
  readonly database: TxSource;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /**
   * Newest first, each only while the thing it names still stands and the
   * member's in-app channel for its kind is on.
   */
  readNotifications(input: {
    readonly userId: string;
    /**
     * Whether this member may read one tournament lobby now: the ordinary Tab
     * read fences. Without it no tournament notification stands (NTF-15).
     */
    readonly canReadTournament?: TournamentInboxAccess | undefined;
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
      const tournament = await standingTournamentNotifications(database, {
        userId: input.userId,
        canReadTournament: input.canReadTournament,
        unreadOnly: input.unreadOnly,
      });
      const shown = sql`n.user_id=${input.userId}
        and ${notificationStands(
          sql`${input.now}::timestamptz`,
          tournamentStanding(tournament.keys()),
        )}
        and ${wants(sql`n.kind`, 'in_app', sql`n.user_id`)}`;
      const after =
        input.after === null
          ? sql``
          : sql`and (n.surfaced_at,n.id) < (${input.after.surfacedAt}::timestamptz,${input.after.id})`;
      const rows = await readInboxRows(database, {
        where: sql`${shown} ${input.unreadOnly ? sql`and n.read_at is null` : sql``} ${after}`,
        limit: input.limit + 1,
        tournament,
      });
      const [count] = await query(
        database,
        z.object({ unread: postgresInt8 }),
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
      inTransaction(database, async (tx) => {
        const some =
          input.notificationIds === 'all'
            ? sql``
            : sql`and id in (select jsonb_array_elements_text(${JSON.stringify(input.notificationIds)}::text::jsonb))`;
        const changed = await query(
          tx,
          z.object({ id: z.string() }),
          sql`update notifications set read_at=${input.at}::timestamptz
            where user_id=${input.userId} and read_at is null ${some} returning id`,
        );
        if (changed.length === 0) return;
        const [actor] = await query(
          tx,
          z.object({ id: z.string() }),
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
      const gone = await query(
        database,
        z.object({ id: z.string() }),
        sql`delete from notifications where id in (select id from notifications
            where read_at < ${input.before}::timestamptz limit ${input.limit})
          returning id`,
      );
      return gone.length;
    });
  },
});
