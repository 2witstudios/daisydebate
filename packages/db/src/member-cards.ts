import {
  roundOutcomeSchema,
  roundStatusSchema,
  seatKindSchema,
} from '@daisy/protocol';
import { sql, type SQL } from 'drizzle-orm';
import { daisyOrganizationId } from './daisy-reference';
import {
  ratingStyles,
  type RatingDivision,
  type RatingStyle,
  ratingDivisions,
} from '@daisy/protocol';
import { roundOutcomeSql } from './round-outcome-sql';
import { seatOfColumns } from './seat-columns';
import { instrumented, type DatabaseEventSink } from './instrumented';
import {
  factReleasedSql,
  outcomeReleasedSql,
  roundAliasR,
  type ReleaseRound,
  type SpectatorClock,
} from './spectator-release-sql';
import { youthRoundSql } from './youth-round-sql';
import type { TxSource } from './tx';
import { query } from './raw-rows';
import { z } from 'zod';

type CardRatingRow = {
  readonly actorId: string;
  /** The ladder's style and division (ADR 0147). */
  readonly ladder: RatingStyle;
  readonly division: RatingDivision;
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

/**
 * Each actor's rating on each Daisy ladder (style and division) in that
 * division's active season, released.
 */
const readCardRatings = async (
  database: TxSource,
  ids: SQL,
  clock: SpectatorClock,
): Promise<readonly CardRatingRow[]> => {
  const postingReleased = factReleasedSql(
    sql`greatest(c.occurred_at, held_r.completed_at)`,
    postingRound,
    clock,
  );
  const postings = sql`rating_changes c join rounds held_r on held_r.id = c.round_id
    where c.actor_id = r.actor_id and c.ladder = r.ladder and c.division = r.division and c.season_id = r.season_id`;
  const ratings = await query(
    database,
    z.object({
      division: z.enum(ratingDivisions),
      actorId: z.string(),
      rating: z.number(),
      ladder: z.literal('freestyle'),
      deviation: z.number(),
      volatility: z.number(),
      lastRatedAt: z.union([z.string(), z.date()]).nullable(),
      heldRating: z.number().nullable(),
      heldDeviation: z.number().nullable(),
      heldVolatility: z.number().nullable(),
    }),
    sql`
    select r.actor_id as "actorId", r.ladder, r.division, r.rating, r.deviation, r.volatility,
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
    where r.actor_id = any(${ids})`,
  );
  return ratings
    .filter((row) => ratingStyles.includes(row.ladder))
    .flatMap((row) => releasedCardRating(row) ?? []);
};

const actorIdArray = (actorIds: readonly string[]) =>
  sql`array[${sql.join(
    actorIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`;

/**
 * What each person's card may show (ADR 0103, ADR 0142): their rating on each
 * Daisy ladder in the active season, and the shape of their public record,
 * taken as a named read of Ratings and Rounds. One read for a page of people.
 * Both wait for the spectator timeline,
 * so a card never tells the outcome of a Round still on its delay.
 */
export const memberCardOperations = ({
  database,
  eventSink,
}: {
  readonly database: TxSource;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** Public Rounds only, never a Youth Round (ADR 0150), for any viewer. */
  readMemberCards: (actorIds: readonly string[], clock: SpectatorClock) =>
    instrumented(eventSink, 'readMemberCards', async () => {
      if (actorIds.length === 0) return { ratings: [], records: [] };
      const ids = actorIdArray(actorIds);
      const recordsRead = query(
        database,
        z.object({
          actorId: z.string(),
          status: roundStatusSchema,
          outcome: roundOutcomeSchema.nullable(),
          seatKind: seatKindSchema,
          side: z.string().nullable(),
          slot: z.int(),
          rounds: z.int(),
        }),
        sql`
        select p.actor_id as "actorId", r.status, ${roundOutcomeSql('r')} as outcome,
          p.seat_kind as "seatKind", p.side, p.slot, count(*)::int as rounds
        from round_participants p join rounds r on r.id = p.round_id
        where p.actor_id = any(${ids}) and r.room_id is not null and r.visibility = 'public'
          and not ${youthRoundSql(sql`r.id`)}
          and ${outcomeReleasedSql(roundAliasR, clock)}
        group by p.actor_id, r.status, 3, p.seat_kind, p.side, p.slot`,
      );
      const [ratings, records] = await Promise.all([
        readCardRatings(database, ids, clock),
        recordsRead,
      ]);
      return {
        ratings,
        records: records.map(({ seatKind, side, slot, ...row }) => ({
          ...row,
          seat: seatOfColumns({ seatKind, side, slot }),
        })),
      };
    }),
  /**
   * The card's ratings alone, for one batch of seated actors (a Room's
   * seats, SEAT-7): the same released active-season read, without records.
   */
  readMemberCardRatings: (actorIds: readonly string[], clock: SpectatorClock) =>
    instrumented(eventSink, 'readMemberCardRatings', async () =>
      actorIds.length === 0
        ? []
        : readCardRatings(database, actorIdArray(actorIds), clock),
    ),
});
