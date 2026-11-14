import { sql } from 'drizzle-orm';
import { daisyOrganizationId } from './daisy-reference';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { ratingLadders, type RatingLadder } from '@daisy/protocol';
import { instrumented, type DatabaseEventSink } from './instrumented';
import {
  factReleasedSql,
  outcomeReleasedSql,
  roundAliasR,
  type ReleaseRound,
  type SpectatorClock,
} from './spectator-release-sql';

type Visibility = {
  readonly showPolicy: boolean;
  readonly showValue: boolean;
};

type CardRatingRow = {
  readonly actorId: string;
  readonly ladder: RatingLadder;
  readonly rating: number;
  readonly deviation: number;
  readonly volatility: number;
  readonly lastRatedAt: string | null;
};

/** The Round of a ledger posting, under `held_r`. */
const postingRound: ReleaseRound = {
  id: sql`held_r.id`,
  status: sql`held_r.status`,
  competitionType: sql`held_r.competition_type`,
  completedAt: sql`held_r.completed_at`,
};

type CardRatingRead = Omit<CardRatingRow, 'lastRatedAt'> & {
  readonly lastRatedAt: Date | string | null;
  /** The earliest posting the timeline still holds: the rating before it. */
  readonly heldRating: number | null;
  readonly heldDeviation: number | null;
  readonly heldVolatility: number | null;
};

/**
 * The rating an audience may know, the ledger's rule as `releasedStandings`
 * has it: it stands where the earliest held posting found it, and a debater
 * with nothing released yet is not rated at all.
 */
const releasedCardRating = (row: CardRatingRead): CardRatingRow | null => {
  const { heldRating, heldDeviation, heldVolatility, lastRatedAt, ...rating } =
    row;
  const shownAt =
    lastRatedAt === null ? null : new Date(lastRatedAt).toISOString();
  if (heldRating === null) return { ...rating, lastRatedAt: shownAt };
  if (shownAt === null) return null;
  return {
    ...rating,
    rating: heldRating,
    deviation: heldDeviation ?? rating.deviation,
    volatility: heldVolatility ?? rating.volatility,
    lastRatedAt: shownAt,
  };
};

type CardRecordRow = {
  readonly actorId: string;
  readonly status: string;
  readonly outcome: string | null;
  readonly role: string;
  readonly rounds: number;
};

/**
 * What each person's card may show (ADR 0103): every rated ladder they turned
 * on, Freestyle always, in the active season, and the shape of their public
 * record, taken as a named read of Ratings and Rounds. One read for a page of
 * people. Ladders stay public regardless. Both wait for the spectator timeline,
 * so a card never tells the outcome of a Round still on its delay.
 */
export const memberCardOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  readMemberCards: (actorIds: readonly string[], clock: SpectatorClock) =>
    instrumented(eventSink, 'readMemberCards', async () => {
      if (actorIds.length === 0)
        return { ratings: [], records: [], visibility: [] };
      const ids = sql`array[${sql.join(
        actorIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::text[]`;
      const visibilityRead = database.execute(sql`
        select actor_id as "actorId", show_policy as "showPolicy", show_value as "showValue"
        from rating_visibility where actor_id = any(${ids})`);
      const postingReleased = factReleasedSql(
        sql`greatest(c.occurred_at, held_r.completed_at)`,
        postingRound,
        clock,
      );
      const postings = sql`rating_changes c join rounds held_r on held_r.id = c.round_id
        where c.actor_id = r.actor_id and c.ladder = r.ladder and c.season_id = r.season_id`;
      const ratingsRead = database.execute(sql`
        select r.actor_id as "actorId", r.ladder, r.rating, r.deviation, r.volatility,
          (select max(c.occurred_at) from ${postings} and ${postingReleased}) as "lastRatedAt",
          held.rating_before as "heldRating",
          held.deviation_before as "heldDeviation",
          held.volatility_before as "heldVolatility"
        from ratings r join seasons s on s.id = r.season_id and s.status = 'active'
          and s.organization_id = ${daisyOrganizationId}
        left join lateral (
          select c.rating_before, c.deviation_before, c.volatility_before
          from ${postings} and not ${postingReleased}
          order by c.occurred_at asc limit 1
        ) held on true
        where r.actor_id = any(${ids})`);
      const recordsRead = database.execute(sql`
        select p.actor_id as "actorId", r.status, r.outcome, p.role, count(*)::int as rounds
        from round_participants p join rounds r on r.id = p.round_id
        where p.actor_id = any(${ids}) and r.room_id is not null and r.visibility = 'public'
          and ${outcomeReleasedSql(roundAliasR, clock)}
        group by p.actor_id, r.status, r.outcome, p.role`);
      const [visibility, ratings, records] = (await Promise.all([
        visibilityRead,
        ratingsRead,
        recordsRead,
      ])) as unknown as [
        (Visibility & { actorId: string })[],
        CardRatingRead[],
        CardRecordRow[],
      ];
      return {
        visibility: [...visibility],
        ratings: ratings
          .filter((row) => ratingLadders.includes(row.ladder))
          .flatMap((row) => releasedCardRating(row) ?? []),
        records: [...records],
      };
    }),
});
