import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { actors } from './schema/actors';
import { botProfiles } from './schema/bot-profiles';
import { broadcasts } from './schema/broadcasts';
import { rooms } from './schema/rooms';
import { roundParticipants } from './schema/round-participants';
import { roundSegments } from './schema/round-segments';
import { rounds } from './schema/rounds';
import { users } from './schema/users';
import {
  factReleasedSql,
  spectatorHorizonSql,
  type SpectatorClock,
} from './spectator-release-sql';

const roundColumns = {
  id: rounds.id,
  status: rounds.status,
  competitionType: rounds.competitionType,
  completedAt: rounds.completedAt,
};

const debateRoles = ['affirmative', 'negative'] as const;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

export type LiveBroadcastFilter = {
  readonly mode: 'any' | 'ranked' | 'casual';
  readonly q: string;
};

/**
 * On the Live listing: a public Round whose Broadcast is open, once its start has
 * been released and until its end is. A held Broadcast has released nothing and
 * so is absent, and what the audience has not reached never narrows a search.
 */
const onLive = (clock: SpectatorClock) =>
  and(
    eq(rounds.visibility, 'public'),
    sql`${broadcasts.stoppedAt} is null`,
    sql`${broadcasts.completedAt} is null`,
    factReleasedSql(rounds.startedAt, roundColumns, clock),
    sql`not ${factReleasedSql(rounds.completedAt, roundColumns, clock)}`,
  );

const searched = (q: string): SQL | undefined => {
  if (q === '') return undefined;
  const like = `%${escapeLike(q)}%`;
  return sql`(${rooms.title} ilike ${like} or ${rounds.resolution} ilike ${like} or exists (
    select 1 from round_participants p
    join actors a on a.id = p.actor_id
    left join users u on u.id = a.user_id
    left join bot_profiles b on b.actor_id = a.id
    where p.round_id = ${rounds.id} and p.role <> 'judge'
      and (u.username ilike ${like} or b.name ilike ${like})))`;
};

const seatedAny = (usernames: readonly string[] | undefined) =>
  usernames === undefined
    ? undefined
    : sql`exists (
    select 1 from round_participants p
    join actors a on a.id = p.actor_id
    join users u on u.id = a.user_id
    where p.round_id = ${rounds.id} and p.role in ('affirmative','negative')
      and u.username in ${
        usernames.length === 0
          ? sql`(null)`
          : sql`(${sql.join(
              usernames.map((name) => sql`${name}`),
              sql`, `,
            )})`
      })`;

const moded = (mode: LiveBroadcastFilter['mode']) =>
  mode === 'any' ? undefined : eq(rounds.competitionType, mode);

const cursorRound = {
  id: sql`c.id`,
  status: sql`c.status`,
  competitionType: sql`c.competition_type`,
  completedAt: sql`c.completed_at`,
};

/** A cursor at a Round not yet on Live reads as a missing one: polling learns no start. */
const afterCursor = (before: string, clock: SpectatorClock): SQL | undefined =>
  before === ''
    ? undefined
    : sql`(${rounds.startedAt}, ${rounds.id}) < (select c.started_at, c.id from rounds c
        where c.id = ${before} and c.visibility = 'public'
          and ${factReleasedSql(sql`c.started_at`, cursorRound, clock)})`;

/**
 * The Live listing, paged and filtered in SQL under the one release rule. Rows
 * only: the feature projects them through the same stage rule as the player.
 */
export const liveBroadcastReads = ({
  database,
}: {
  readonly database: BunSQLDatabase;
}) => ({
  /**
   * The Round of a Room anyone may be sent to Watch for: public, with its start
   * released. An unlisted Round is reached by its own link and a private one not at
   * all, so a Room link alone grants neither.
   */
  async readWatchableRoundOfRoom(
    roomId: string,
    clock: SpectatorClock,
  ): Promise<string | null> {
    const [round] = await database
      .select({ id: rounds.id })
      .from(rounds)
      .where(
        and(
          eq(rounds.roomId, roomId),
          eq(rounds.visibility, 'public'),
          factReleasedSql(rounds.startedAt, roundColumns, clock),
        ),
      );
    return round?.id ?? null;
  },
  listLiveBroadcasts(input: {
    readonly filter: LiveBroadcastFilter;
    readonly before: string;
    readonly clock: SpectatorClock;
    readonly limit: number;
    /** Narrows to Rounds these debaters are seated in; an empty list finds none. */
    readonly seatedUsernames?: readonly string[];
  }) {
    return database.transaction(
      async (tx) => {
        const page = await tx
          .select({
            id: rounds.id,
            title: rooms.title,
            status: rounds.status,
            competitionType: rounds.competitionType,
            resolution: rounds.resolution,
            rules: rounds.rulesSnapshot,
            startedAt: rounds.startedAt,
            horizon: sql<
              Date | string | null
            >`${spectatorHorizonSql(roundColumns, input.clock)}`,
          })
          .from(rounds)
          .innerJoin(rooms, eq(rooms.id, rounds.roomId))
          .innerJoin(broadcasts, eq(broadcasts.roundId, rounds.id))
          .where(
            and(
              onLive(input.clock),
              moded(input.filter.mode),
              searched(input.filter.q),
              seatedAny(input.seatedUsernames),
              afterCursor(input.before, input.clock),
            ),
          )
          .orderBy(desc(rounds.startedAt), desc(rounds.id))
          .limit(input.limit + 1);
        const shown = page.slice(0, input.limit);
        const ids = shown.map((row) => row.id);
        if (ids.length === 0) return { rows: [], nextBefore: null };
        const seats = await tx
          .select({
            roundId: roundParticipants.roundId,
            side: roundParticipants.role,
            kind: actors.kind,
            username: users.username,
            botName: botProfiles.name,
          })
          .from(roundParticipants)
          .innerJoin(actors, eq(actors.id, roundParticipants.actorId))
          .leftJoin(users, eq(users.id, actors.userId))
          .leftJoin(botProfiles, eq(botProfiles.actorId, actors.id))
          .where(
            and(
              inArray(roundParticipants.roundId, ids),
              inArray(roundParticipants.role, [...debateRoles]),
            ),
          )
          .orderBy(asc(roundParticipants.role));
        const segments = await tx
          .selectDistinctOn([roundSegments.roundId], {
            roundId: roundSegments.roundId,
            type: roundSegments.type,
            key: roundSegments.rulesSegmentKey,
            startedAt: roundSegments.startedAt,
            endedAt: roundSegments.endedAt,
            durationMs: roundSegments.durationMs,
          })
          .from(roundSegments)
          .innerJoin(rounds, eq(rounds.id, roundSegments.roundId))
          .where(
            and(
              inArray(roundSegments.roundId, ids),
              factReleasedSql(
                roundSegments.startedAt,
                roundColumns,
                input.clock,
              ),
            ),
          )
          .orderBy(roundSegments.roundId, desc(roundSegments.sequence));
        return {
          rows: shown.map((row) => ({
            ...row,
            competitionType: row.competitionType as 'ranked' | 'casual',
            horizonMs:
              row.horizon === null ? null : new Date(row.horizon).getTime(),
            seats: seats.filter((seat) => seat.roundId === row.id),
            segments: segments.filter((segment) => segment.roundId === row.id),
          })),
          nextBefore:
            page.length > input.limit ? (shown.at(-1)?.id ?? null) : null,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  },
  async countLiveBroadcasts(input: { readonly clock: SpectatorClock }) {
    const [row] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(rounds)
      .innerJoin(broadcasts, eq(broadcasts.roundId, rounds.id))
      .where(onLive(input.clock));
    return row?.count ?? 0;
  },
});

export type LiveBroadcastPage = Awaited<
  ReturnType<ReturnType<typeof liveBroadcastReads>['listLiveBroadcasts']>
>;
