import { SPECTATOR_MARGIN_MS, type NotificationKind } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { blockedBetween } from '../debater-follows';
import { rowsOf } from '../raw-rows';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import {
  outcomeReleasedSql,
  roundAliasR,
  type SpectatorClock,
} from '../spectator-release-sql';
import { wants } from './preferences';

type Tx = Pick<BunSQLDatabase, 'execute'>;

const spectatorMargin = sql.raw(
  `interval '${SPECTATOR_MARGIN_MS} milliseconds'`,
);

const seatedDebaters = (roundId: string) =>
  sql`select p.actor_id from round_participants p
    where p.round_id=${roundId} and p.role in ('affirmative','negative')`;

/** Followers of a seated debater, each once, none seated in the Round themselves. */
const followersOf = (roundId: string, kind: NotificationKind) =>
  sql`select distinct on (u.id) u.id as user_id,f.debater_actor_id as actor_id
    from debater_follows f join users u on u.id=f.follower_user_id and u.deleted_at is null
    where f.debater_actor_id in (${seatedDebaters(roundId)})
      and ${wants(kind, 'in_app', sql`u.id`)}
      and not ${blockedBetween(sql`u.id`, sql`f.debater_actor_id`)}
      and not exists(select 1 from round_participants p join actors a on a.id=p.actor_id
        where p.round_id=${roundId} and a.user_id=u.id)
    order by u.id,f.debater_actor_id`;

const seatedAccounts = (roundId: string) =>
  sql`select distinct u.id as user_id,null::text as actor_id
    from round_participants p join actors a on a.id=p.actor_id
    join users u on u.id=a.user_id and u.deleted_at is null
    where p.round_id=${roundId} and ${wants('recording_ready', 'in_app', sql`u.id`)}`;

type Recipient = {
  readonly user_id: string;
  readonly actor_id: string | null;
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
      actor_id: recipient.actor_id,
    })),
  );
  const written = await rowsOf(
    tx,
    sql`insert into notifications(id,user_id,kind,round_id,actor_id,created_at)
      select w.id,w.user_id,${input.kind},${input.roundId},w.actor_id,${input.at}::timestamptz
      from jsonb_to_recordset(${rows}::text::jsonb) as w(id text,user_id text,actor_id text)
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
export const watchNotificationOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /**
   * One pass. `followed_debater_live` follows the Broadcast's first released
   * speech, so it never sends a follower to a debate that has not begun; `recording_ready` a ready Recording once any Broadcast is complete,
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
            and (b.completed_at is not null or b.stopped_at is not null
              or exists(select 1 from round_segments s where s.round_id=b.round_id
                and s.started_at+${spectatorMargin}<=b.released_through_at))
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
              ...followers.map((row) => ({ ...row, actor_id: null })),
            ],
          );
        });
      return written;
    });
  },
});
