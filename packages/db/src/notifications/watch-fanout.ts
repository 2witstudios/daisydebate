import { SPECTATOR_MARGIN_MS, type NotificationKind } from '@daisy/protocol';
import { isDebatingSeatSql } from '../seat-columns';
import { sql } from 'drizzle-orm';
import { blockedBetween } from '../debater-follows';
import { rowsOf, query } from '../raw-rows';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import {
  outcomeReleasedSql,
  roundAliasR,
  type SpectatorClock,
} from '../spectator-release-sql';
import { oweNotifications } from './owe';
import { wants } from './preferences';
import { youthRoundSql } from '../youth-round-sql';
import { operatorWithheldSql } from '../broadcast-withheld-sql';
import { inTransaction, type Tx, type TxSource } from '../tx';
import { z } from 'zod';

const spectatorMargin = sql.raw(
  `interval '${SPECTATOR_MARGIN_MS} milliseconds'`,
);

const seatedDebaters = (roundId: string) =>
  sql`select p.actor_id from round_participants p
    where p.round_id=${roundId} and ${isDebatingSeatSql(sql`p.seat_kind`)}`;

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

/** A Youth Round's Recording reaches only its current seats (ADR 0157). */
const seatedAccounts = (roundId: string, youth: boolean) =>
  sql`select distinct u.id as user_id,null::text as actor_id
    from round_participants p join actors a on a.id=p.actor_id
    join users u on u.id=a.user_id and u.deleted_at is null
    where p.round_id=${roundId}
      ${youth ? sql`and public.daisy_round_participant_is_current(p.id)` : sql``}
      and ${wants('recording_ready', 'in_app', sql`u.id`)}`;

type Recipient = {
  readonly user_id: string;
  readonly actor_id: string | null;
};

/** The kinds Watch's fan-out writes, both about a Round. */
type WatchKind = 'followed_debater_live' | 'recording_ready';

/** Writes one released event's notifications through the one writer (ADR 0144). */
const owe = (
  tx: Tx,
  input: {
    readonly kind: WatchKind;
    readonly roundId: string;
    readonly at: string;
    readonly nextId: () => string;
  },
  recipients: readonly Recipient[],
) =>
  oweNotifications(tx, {
    kind: input.kind,
    subject: { round_id: input.roundId },
    recipients: recipients.map((row) => ({
      userId: row.user_id,
      about: row.actor_id,
    })),
    at: input.at,
    nextId: input.nextId,
  });

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
  readonly database: TxSource;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /**
   * One pass. `followed_debater_live` follows the Broadcast's first released
   * speech, so it never sends a follower to a debate that has not begun; `recording_ready` a ready Recording once any Broadcast is complete,
   * and its outcome released. Each event claims itself in its own transaction, so
   * a repeat or a second instance tells no one twice, and each row rings its
   * member's inbox. Returns rows written.
   */
  sweepNotificationFanouts(input: {
    readonly clock: SpectatorClock;
    readonly limit: number;
    readonly nextId: () => string;
  }) {
    return instrumented(eventSink, 'sweepNotificationFanouts', async () => {
      const at = input.clock.now;
      const live = await query(
        database,
        z.object({
          round_id: z.string(),
          visibility: z.string(),
          on_air: z.boolean(),
        }),
        sql`select b.round_id,r.visibility,(b.completed_at is null and b.stopped_at is null) as on_air
          from broadcasts b join rounds r on r.id=b.round_id
          where b.released_through_at is not null
            -- A Youth Round has no audience to send a follower to (ADR 0150, 0157).
            and not ${youthRoundSql(sql`b.round_id`)}
            and (b.completed_at is not null or b.stopped_at is not null
              or exists(select 1 from round_segments s where s.round_id=b.round_id
                and s.started_at+${spectatorMargin}<=b.released_through_at))
            and not exists(select 1 from notification_fanouts f
              where f.kind='followed_debater_live' and f.round_id=b.round_id)
          order by b.created_at limit ${input.limit}`,
      );
      const ready = await query(
        database,
        z.object({
          round_id: z.string(),
          visibility: z.string(),
          youth: z.boolean(),
        }),
        sql`select rc.round_id,r.visibility,
            ${youthRoundSql(sql`r.id`)} as youth
          from recordings rc join rounds r on r.id=rc.round_id
          left join broadcasts b on b.round_id=rc.round_id
          where rc.status='ready'
            -- Only an operator's stop holds the notice back (ADR 0150, 0157).
            and (b.id is null or (b.completed_at is not null
              and not ${operatorWithheldSql(sql`b`)}))
            and ${outcomeReleasedSql(roundAliasR, input.clock)}
            and not exists(select 1 from notification_fanouts f
              where f.kind='recording_ready' and f.round_id=rc.round_id)
          order by rc.created_at limit ${input.limit}`,
      );
      let written = 0;
      for (const event of live)
        written += await inTransaction(database, async (tx) => {
          const kind = 'followed_debater_live';
          if (!(await claimFanout(tx, kind, event.round_id))) return 0;
          // Only a public Round reaches a follower, and only while on air.
          if (event.visibility !== 'public' || !event.on_air) return 0;
          return owe(
            tx,
            { kind, roundId: event.round_id, at, nextId: input.nextId },
            await query(
              tx,
              z.object({
                user_id: z.string(),
                actor_id: z.string().nullable(),
              }),
              followersOf(event.round_id, kind),
            ),
          );
        });
      for (const event of ready)
        written += await inTransaction(database, async (tx) => {
          const kind = 'recording_ready';
          if (!(await claimFanout(tx, kind, event.round_id))) return 0;
          const seated = await query(
            tx,
            z.object({ user_id: z.string(), actor_id: z.string().nullable() }),
            seatedAccounts(event.round_id, event.youth),
          );
          // A Youth Round is private to its people (ADR 0150): no follower hears of it.
          const followers =
            event.visibility === 'public' && !event.youth
              ? await query(
                  tx,
                  z.object({
                    user_id: z.string(),
                    actor_id: z.string().nullable(),
                  }),
                  followersOf(event.round_id, kind),
                )
              : [];
          return owe(
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
