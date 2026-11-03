import {
  notificationKinds,
  type NotificationKind,
  type NotificationPreferences,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { blockedBetween } from './debater-follows';
import { rowsOf } from './raw-rows';
import { instrumented, type DatabaseEventSink } from './instrumented';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';
import {
  outcomeReleasedSql,
  roundAliasR,
  type SpectatorClock,
} from './spectator-release-sql';

type Tx = Pick<BunSQLDatabase, 'execute'>;

const wants = (kind: NotificationKind, user: ReturnType<typeof sql>) =>
  sql`coalesce((select np.enabled from notification_preferences np
    where np.user_id=${user} and np.kind=${kind}),true)`;

const seatedDebaters = (roundId: string) =>
  sql`select p.actor_id from round_participants p
    where p.round_id=${roundId} and p.role in ('affirmative','negative')`;

/** Followers of a seated debater, each once, none seated in the Round themselves. */
const followersOf = (roundId: string, kind: NotificationKind) =>
  sql`select distinct on (u.id) u.id as user_id,f.debater_actor_id
    from debater_follows f join users u on u.id=f.follower_user_id and u.deleted_at is null
    where f.debater_actor_id in (${seatedDebaters(roundId)})
      and ${wants(kind, sql`u.id`)}
      and not ${blockedBetween(sql`u.id`, sql`f.debater_actor_id`)}
      and not exists(select 1 from round_participants p join actors a on a.id=p.actor_id
        where p.round_id=${roundId} and a.user_id=u.id)
    order by u.id,f.debater_actor_id`;

const seatedAccounts = (roundId: string) =>
  sql`select distinct u.id as user_id,null::text as debater_actor_id
    from round_participants p join actors a on a.id=p.actor_id
    join users u on u.id=a.user_id and u.deleted_at is null
    where p.round_id=${roundId} and ${wants('recording_ready', sql`u.id`)}`;

type Recipient = {
  readonly user_id: string;
  readonly debater_actor_id: string | null;
};

const writeAll = async (
  tx: Tx,
  input: {
    readonly kind: NotificationKind;
    readonly roundId: string;
    readonly at: string;
    readonly nextId: () => string;
  },
  recipients: readonly Recipient[],
) => {
  if (recipients.length === 0) return 0;
  const rows = JSON.stringify(
    recipients.map((recipient) => ({
      id: input.nextId(),
      user_id: recipient.user_id,
      debater_actor_id: recipient.debater_actor_id,
    })),
  );
  const written = await rowsOf(
    tx,
    sql`insert into notifications(id,user_id,kind,round_id,debater_actor_id,created_at)
      select w.id,w.user_id,${input.kind},${input.roundId},w.debater_actor_id,${input.at}::timestamptz
      from jsonb_to_recordset(${rows}::text::jsonb) as w(id text,user_id text,debater_actor_id text)
      on conflict do nothing returning id`,
  );
  return written.length;
};

const claimFanout = async (
  tx: Tx,
  kind: NotificationKind,
  roundId: string,
): Promise<boolean> =>
  (
    await rowsOf(
      tx,
      sql`insert into notification_fanouts(kind,round_id) values(${kind},${roundId})
        on conflict do nothing returning round_id`,
    )
  ).length === 1;

/**
 * Notifications (WATCH-12). Nothing is written before release, because the
 * sweep starts from the released facts alone; it reads Broadcast and Recording as
 * named inputs and changes neither. A read re-checks the thing still stands.
 */
export const notificationOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /**
   * One pass. `followed_debater_live` follows the Broadcast's first released
   * media; `recording_ready` a ready Recording once any Broadcast is complete,
   * and its outcome released. Each event claims itself in its own transaction, so
   * a repeat or a second instance tells no one twice. Returns rows written.
   */
  sweepNotificationFanouts(input: {
    readonly clock: SpectatorClock;
    readonly limit: number;
    readonly nextId: () => string;
  }) {
    return instrumented(eventSink, 'sweepNotificationFanouts', async () => {
      const at = input.clock.now;
      const live = await rowsOf<{
        round_id: string;
        visibility: string;
        on_air: boolean;
      }>(
        database,
        sql`select b.round_id,r.visibility,(b.completed_at is null and b.stopped_at is null) as on_air
          from broadcasts b join rounds r on r.id=b.round_id
          where b.released_through_at is not null
            and not exists(select 1 from notification_fanouts f
              where f.kind='followed_debater_live' and f.round_id=b.round_id)
          order by b.created_at limit ${input.limit}`,
      );
      const ready = await rowsOf<{ round_id: string; visibility: string }>(
        database,
        sql`select rc.round_id,r.visibility
          from recordings rc join rounds r on r.id=rc.round_id
          left join broadcasts b on b.round_id=rc.round_id
          where rc.status='ready'
            and (b.id is null or (b.completed_at is not null and not b.media_withheld))
            and ${outcomeReleasedSql(roundAliasR, input.clock)}
            and not exists(select 1 from notification_fanouts f
              where f.kind='recording_ready' and f.round_id=rc.round_id)
          order by rc.created_at limit ${input.limit}`,
      );
      let written = 0;
      for (const event of live)
        written += await database.transaction(async (tx) => {
          const kind = 'followed_debater_live';
          if (!(await claimFanout(tx, kind, event.round_id))) return 0;
          // Only a public Round reaches a follower, and only while on air.
          if (event.visibility !== 'public' || !event.on_air) return 0;
          return writeAll(
            tx,
            { kind, roundId: event.round_id, at, nextId: input.nextId },
            await rowsOf<Recipient>(tx, followersOf(event.round_id, kind)),
          );
        });
      for (const event of ready)
        written += await database.transaction(async (tx) => {
          const kind = 'recording_ready';
          if (!(await claimFanout(tx, kind, event.round_id))) return 0;
          const seated = await rowsOf<Recipient>(
            tx,
            seatedAccounts(event.round_id),
          );
          const followers =
            event.visibility === 'public'
              ? await rowsOf<Recipient>(tx, followersOf(event.round_id, kind))
              : [];
          return writeAll(
            tx,
            { kind, roundId: event.round_id, at, nextId: input.nextId },
            [
              ...seated,
              // A followers' row needs no debater once it is about a Recording.
              ...followers.map((row) => ({ ...row, debater_actor_id: null })),
            ],
          );
        });
      return written;
    });
  },
  /** Newest first, each only while the thing it names still stands. */
  readNotifications(input: {
    readonly userId: string;
    readonly unreadOnly: boolean;
    readonly limit: number;
  }) {
    return instrumented(eventSink, 'readNotifications', async () => {
      const standing = sql`(
        (n.kind='followed_debater_live' and r.visibility='public' and u.username is not null)
        or (n.kind='recording_ready' and rc.status='ready'))`;
      const from = sql`from notifications n
        join rounds r on r.id=n.round_id
        left join actors a on a.id=n.debater_actor_id
        left join users u on u.id=a.user_id and u.deleted_at is null
        left join recordings rc on rc.round_id=n.round_id
        where n.user_id=${input.userId} and ${standing}`;
      const rows = await rowsOf<{
        id: string;
        kind: NotificationKind;
        roundId: string;
        debater: string | null;
        readAt: string | null;
        createdAt: string;
      }>(
        database,
        sql`select n.id,n.kind,n.round_id as "roundId",u.username as debater,
            to_char(n.read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "readAt",
            to_char(n.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt"
          ${from} ${input.unreadOnly ? sql`and n.read_at is null` : sql``}
          order by n.created_at desc,n.id desc limit ${input.limit}`,
      );
      const [count] = await rowsOf<{ unread: number | string }>(
        database,
        sql`select count(*) as unread ${from} and n.read_at is null`,
      );
      return { rows, unread: Number(count?.unread ?? 0) };
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
  readNotificationPreferences(input: {
    readonly userId: string;
  }): Promise<Omit<NotificationPreferences, 'version'>> {
    return instrumented(eventSink, 'readNotificationPreferences', async () => {
      const rows = await rowsOf<{ kind: NotificationKind; enabled: boolean }>(
        database,
        sql`select kind,enabled from notification_preferences where user_id=${input.userId}`,
      );
      const stored = new Map(rows.map((row) => [row.kind, row.enabled]));
      return {
        followed_debater_live: stored.get('followed_debater_live') ?? true,
        recording_ready: stored.get('recording_ready') ?? true,
      };
    });
  },
  writeNotificationPreferences(input: {
    readonly userId: string;
    readonly preferences: Omit<NotificationPreferences, 'version'>;
  }) {
    return instrumented(eventSink, 'writeNotificationPreferences', () =>
      database.transaction(async (tx) => {
        for (const kind of notificationKinds)
          await tx.execute(sql`insert into notification_preferences(user_id,kind,enabled)
            select u.id,${kind},${input.preferences[kind]} from users u
            where u.id=${input.userId} and u.deleted_at is null
            on conflict (user_id,kind) do update set enabled=excluded.enabled`);
      }),
    );
  },
});

/**
 * The subject's notifications and choices go, and any notification telling
 * someone else that the subject was on air.
 */
export const notificationPrivacyAdopter: PrivacyAdopter = {
  id: 'notifications',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await tx.execute(sql`delete from notifications
      where user_id=${subject.userId} or debater_actor_id=${subject.actorId}`);
    await tx.execute(
      sql`delete from notification_preferences where user_id=${subject.userId}`,
    );
  },
  export: async (tx, subject) => ({
    notifications: exportRows(
      await rowsOf<Record<string, unknown>>(
        tx,
        sql`select kind,round_id,read_at,created_at from notifications
          where user_id=${subject.userId} order by created_at,id`,
      ),
    ),
    notification_preferences: exportRows(
      await rowsOf<Record<string, unknown>>(
        tx,
        sql`select kind,enabled from notification_preferences
          where user_id=${subject.userId} order by kind`,
      ),
    ),
  }),
};
