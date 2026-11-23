import { roomVisibilities } from '@daisy/protocol/room-contract';
import { listedWord } from './lifecycle-sql';
import { audienceReactionKinds } from '@daisy/protocol/audience';
import { sql } from 'drizzle-orm';
import { inLiveRoomSql, liveRoomOfR } from './live-room-sql';
import type { RoundAudienceAdmission } from './messaging/spectator-chat';
import { postgresInt8, run, query } from './raw-rows';
import { instrumented, type DatabaseEventSink } from './instrumented';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';
import { inTransaction, type Tx, type TxSource } from './tx';
import { z } from 'zod';

/**
 * The totals inside a caller's snapshot: anonymous and current. Reactions are the
 * audience talking to itself, so nothing holds them back (ADR 0108).
 */
export const readReactionTotals = async (
  tx: Tx,
  input: { readonly roundId: string },
) =>
  (
    await query(
      tx,
      z.object({ kind: z.enum(audienceReactionKinds), count: postgresInt8 }),
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
  readonly database: TxSource;
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
      inTransaction(database, async (tx) => {
        const [round] = await query(
          tx,
          z.object({
            visibility: z.enum(['public', 'unlisted']),
            audience_link_hash: z.string().nullable(),
            in_live_room: z.boolean(),
            has_broadcast: z.boolean(),
            open: z.boolean(),
            banned: z.boolean(),
          }),
          sql`select r.visibility,r.audience_link_hash,
              ${inLiveRoomSql(liveRoomOfR, input.actorId)} as in_live_room,
              b.id is not null as has_broadcast,
              (b.completed_at is null and b.stopped_at is null) as open,
              exists(select 1 from audience_bans x where x.user_id=${input.userId}) as banned
            from rounds r left join broadcasts b on b.round_id=r.id
            where r.id=${input.roundId} and r.visibility in (${listedWord(roomVisibilities, 'public')},${listedWord(roomVisibilities, 'unlisted')}) and r.room_id is not null`,
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
        await run(
          tx,
          sql`insert into audience_reactions(id,round_id,user_id,kind,spaced_at,created_at)
          select ${input.id},${input.roundId},u.id,${input.kind},${input.spacedAt}::timestamptz,${input.at}::timestamptz
          from users u where u.id=${input.userId} and u.deleted_at is null
          on conflict do nothing`,
        );
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
        const gone = await query(
          database,
          z.object({ id: z.string() }),
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
    await run(
      tx,
      sql`delete from audience_reactions where user_id=${subject.userId}`,
    );
  },
  export: async (tx, subject) => ({
    audience_reactions: exportRows(
      await query(
        tx,
        z.object({
          round_id: z.string(),
          kind: z.enum(audienceReactionKinds),
          created_at: z.date(),
        }),
        sql`select round_id,kind,created_at from audience_reactions
          where user_id=${subject.userId} order by created_at,id`,
      ),
    ),
  }),
};
