import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';
import {
  factReleasedSql,
  roundAliasR,
  type SpectatorClock,
} from './spectator-release-sql';

const rowsOf = async <T>(
  tx: Pick<BunSQLDatabase, 'execute'>,
  query: ReturnType<typeof sql>,
) => (await tx.execute(query)) as unknown as T[];

/** The released totals inside a caller's snapshot: anonymous, by the one rule. */
export const readReleasedReactions = async (
  tx: Pick<BunSQLDatabase, 'execute'>,
  input: { readonly roundId: string; readonly clock: SpectatorClock },
) =>
  (
    await rowsOf<{ kind: string; count: number | string }>(
      tx,
      sql`select ar.kind,count(*) as count
        from audience_reactions ar join rounds r on r.id=ar.round_id
        where ar.round_id=${input.roundId}
          and ${factReleasedSql(sql`ar.created_at`, roundAliasR, input.clock)}
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
  /** Null when the Round has no audience. A repeat within the window is one reaction. */
  recordAudienceReaction(
    input: {
      readonly id: string;
      readonly roundId: string;
      readonly userId: string;
      readonly kind: string;
      readonly at: string;
      readonly spacedAt: string;
    },
    allow: (facts: {
      readonly broadcastOpen: boolean | null;
      readonly banned: boolean;
    }) => void,
  ) {
    return instrumented(eventSink, 'recordAudienceReaction', () =>
      database.transaction(async (tx) => {
        const [round] = await rowsOf<{
          has_broadcast: boolean;
          open: boolean;
          banned: boolean;
        }>(
          tx,
          sql`select b.id is not null as has_broadcast,
              (b.completed_at is null and b.stopped_at is null) as open,
              exists(select 1 from audience_bans x where x.user_id=${input.userId}) as banned
            from rounds r left join broadcasts b on b.round_id=r.id
            where r.id=${input.roundId} and r.visibility in ('public','unlisted') and r.room_id is not null`,
        );
        if (!round) return null;
        allow({
          broadcastOpen: round.has_broadcast ? round.open : null,
          banned: round.banned,
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
