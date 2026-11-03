import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { rowsOf } from './raw-rows';
import { instrumented, type DatabaseEventSink } from './instrumented';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';

const debaterNamed = (username: string) =>
  sql`select a.id,u.id as user_id from users u join actors a on a.user_id=u.id
    where lower(u.username)=lower(${username}) and u.deleted_at is null and a.kind='human'`;

/** Either side's block between this account and that actor. */
export const blockedBetween = (
  followerUserId: SqlValue,
  debaterActor: SqlValue,
) =>
  sql`exists(select 1 from contact_pairs p join actors fa on fa.user_id=${followerUserId}
    where ((p.low_actor_id=fa.id and p.high_actor_id=${debaterActor}) or (p.high_actor_id=fa.id and p.low_actor_id=${debaterActor}))
      and (p.low_blocks_high or p.high_blocks_low))`;
type SqlValue = string | ReturnType<typeof sql>;

export type DebaterFollowOutcome =
  'following' | 'not_following' | 'unavailable';

/**
 * Following a debater (SPECT-1.4). `unavailable` is one answer for a name that
 * does not exist, for yourself and for a block, so a refusal reveals nothing.
 */
export const debaterFollowOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  setDebaterFollow(input: {
    readonly followerUserId: string;
    readonly username: string;
    readonly state: 'following' | 'not_following';
  }): Promise<DebaterFollowOutcome> {
    return instrumented(eventSink, 'setDebaterFollow', () =>
      database.transaction(async (tx) => {
        const [debater] = await rowsOf<{ id: string; user_id: string }>(
          tx,
          debaterNamed(input.username),
        );
        if (!debater || debater.user_id === input.followerUserId)
          return 'unavailable' as const;
        if (input.state === 'not_following') {
          await tx.execute(sql`delete from debater_follows
            where follower_user_id=${input.followerUserId} and debater_actor_id=${debater.id}`);
          return 'not_following' as const;
        }
        const [blocked] = await rowsOf(
          tx,
          sql`select 1 where ${blockedBetween(input.followerUserId, debater.id)}`,
        );
        if (blocked) return 'unavailable' as const;
        await tx.execute(sql`insert into debater_follows(follower_user_id,debater_actor_id)
          select u.id,${debater.id} from users u
          where u.id=${input.followerUserId} and u.deleted_at is null
          on conflict do nothing`);
        return 'following' as const;
      }),
    );
  },
  /** Null when there is no one to follow here, or it is the viewer themselves. */
  readDebaterFollow(input: {
    readonly followerUserId: string;
    readonly username: string;
  }) {
    return instrumented(eventSink, 'readDebaterFollow', async () => {
      const [debater] = await rowsOf<{ id: string; user_id: string }>(
        database,
        debaterNamed(input.username),
      );
      if (!debater || debater.user_id === input.followerUserId) return null;
      const [row] = await rowsOf(
        database,
        sql`select 1 from debater_follows
          where follower_user_id=${input.followerUserId} and debater_actor_id=${debater.id}`,
      );
      return { following: row !== undefined };
    });
  },
  /** Who this account follows, by name. It is theirs alone: nothing lists followers. */
  listFollowedDebaters(input: {
    readonly followerUserId: string;
    readonly limit: number;
  }) {
    return instrumented(eventSink, 'listFollowedDebaters', async () =>
      (
        await rowsOf<{ username: string }>(
          database,
          sql`select u.username from debater_follows f
            join actors a on a.id=f.debater_actor_id
            join users u on u.id=a.user_id and u.deleted_at is null
            where f.follower_user_id=${input.followerUserId}
            order by lower(u.username) limit ${input.limit}`,
        )
      ).map((row) => row.username),
    );
  },
});

/** Both directions go: the subject's follows, and anyone following the subject. */
export const debaterFollowPrivacyAdopter: PrivacyAdopter = {
  id: 'debater-follows',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await tx.execute(sql`delete from debater_follows
      where follower_user_id=${subject.userId} or debater_actor_id=${subject.actorId}`);
  },
  export: async (tx, subject) => ({
    debater_follows: exportRows(
      await rowsOf<Record<string, unknown>>(
        tx,
        sql`select debater_actor_id,created_at from debater_follows
          where follower_user_id=${subject.userId} order by created_at,debater_actor_id`,
      ),
    ),
  }),
};
