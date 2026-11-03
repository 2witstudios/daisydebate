import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { inLiveRoomSql, liveRoomOfR } from './live-room-sql';
import type { RoundAudienceAdmission } from './messaging/spectator-chat';
import { rowsOf } from './raw-rows';
import { instrumented, type DatabaseEventSink } from './instrumented';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';

/**
 * The totals inside a caller's snapshot: anonymous and current. Reactions are the
 * audience talking to itself, so nothing holds them back (ADR 0108).
 */
export const readReactionTotals = async (
  tx: Pick<BunSQLDatabase, 'execute'>,
  input: { readonly roundId: string },
) =>
  (
    await rowsOf<{ kind: string; count: number | string }>(
      tx,
      sql`select ar.kind,count(*) as count
        from audience_reactions ar
        where ar.round_id=${input.roundId}
        group by ar.kind`,
    )
  ).map((row) => ({ kind: row.kind, count: Number(row.count) }));

/** An account's standing to react, read for the feature's decision. */
export const audienceReactionOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /**
   * Null when the Round has no audience for this request. A repeat within the
   * window is one reaction.
   */
  recordAudienceReaction(
    input: {
      readonly id: string;
      readonly roundId: string;
      readonly userId: string;
      readonly actorId: string | null;
      readonly admit: (admission: RoundAudienceAdmission) => boolean;
      readonly kind: string;
      readonly at: string;
      readonly spacedAt: string;
    },
    allow: (facts: {
      readonly broadcastOpen: boolean | null;
      readonly banned: boolean;
      readonly inLiveRoom: boolean;
    }) => void,
  ) {
    return instrumented(eventSink, 'recordAudienceReaction', () =>
      database.transaction(async (tx) => {
        const [round] = await rowsOf<{
          visibility: 'public' | 'unlisted';
          audience_link_hash: string | null;
          in_live_room: boolean;
          has_broadcast: boolean;
          open: boolean;
          banned: boolean;
        }>(
          tx,
          sql`select r.visibility,r.audience_link_hash,
              ${inLiveRoomSql(liveRoomOfR, input.actorId)} as in_live_room,
              b.id is not null as has_broadcast,
              (b.completed_at is null and b.stopped_at is null) as open,
              exists(select 1 from audience_bans x where x.user_id=${input.userId}) as banned
            from rounds r left join broadcasts b on b.round_id=r.id
            where r.id=${input.roundId} and r.visibility in ('public','unlisted') and r.room_id is not null`,
        );
        if (
          !round ||
          !input.admit({
            visibility: round.visibility,
            audienceLinkHash: round.audience_link_hash,
            inLiveRoom: round.in_live_room,
          })
        )
          return null;
        allow({
          broadcastOpen: round.has_broadcast ? round.open : null,
          banned: round.banned,
          inLiveRoom: round.in_live_room,
        });
        // A closed account writes nothing, even if it was closed a moment ago.
        await tx.execute(sql`insert into audience_reactions(id,round_id,user_id,kind,spaced_at,created_at)
          select ${input.id},${input.roundId},u.id,${input.kind},${input.spacedAt}::timestamptz,${input.at}::timestamptz
          from users u where u.id=${input.userId} and u.deleted_at is null
          on conflict do nothing`);
        return true;
      }),
    );
  },
  /** The retention sweep: a reaction goes 180 days after it was pressed. */
  purgeExpiredAudienceReactions(input: {
    readonly before: string;
    readonly limit: number;
  }) {
    return instrumented(
      eventSink,
      'purgeExpiredAudienceReactions',
      async () => {
        const gone = await rowsOf(
          database,
          sql`delete from audience_reactions where id in (
              select id from audience_reactions
              where created_at < ${input.before}::timestamptz limit ${input.limit})
            returning id`,
        );
        return gone.length;
      },
    );
  },
});

/** Totals stay true after erasure only of who is left: the subject's rows go. */
export const audienceReactionPrivacyAdopter: PrivacyAdopter = {
  id: 'audience-reactions',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await tx.execute(
      sql`delete from audience_reactions where user_id=${subject.userId}`,
    );
  },
  export: async (tx, subject) => ({
    audience_reactions: exportRows(
      await rowsOf<Record<string, unknown>>(
        tx,
        sql`select round_id,kind,created_at from audience_reactions
          where user_id=${subject.userId} order by created_at,id`,
      ),
    ),
  }),
};
