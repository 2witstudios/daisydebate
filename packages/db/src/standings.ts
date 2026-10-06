import type { RatingLadder } from '@daisy/protocol';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { actors } from './schema/actors';
import { debateParticipants } from './schema/debate-participants';
import { debates } from './schema/debates';
import { formats } from './schema/formats';
import { ratingChanges, ratings, seasons } from './schema/ratings';
import { users } from './schema/users';
import { toSeasonRecord, type SeasonRecord } from './seasons';

/**
 * The leaderboard's reads (ADR 0055): the seasons a ladder can show, the
 * ranked formats, and one format and ladder's rows for a set of seasons.
 * Rows only: what they add up to (record, movement, rank) is the feature's
 * pure `summarizeStandings`.
 */

/** A debater's current state on the ladder in one season. */
type StandingRating = {
  readonly seasonId: string;
  readonly actorId: string;
  /** Null once the account is deleted (tombstoned). */
  readonly username: string | null;
  readonly rating: number;
  readonly deviation: number;
};

/** One ledger posting, with the debater's seat and the debate's outcome. */
type StandingChange = {
  readonly seasonId: string;
  readonly actorId: string;
  readonly debateId: string;
  readonly ratingBefore: number;
  readonly ratingAfter: number;
  readonly occurredAt: string;
  readonly role: 'affirmative' | 'negative';
  readonly outcome: 'affirmative' | 'negative' | 'draw';
};

export type StandingsRead = {
  readonly ratings: readonly StandingRating[];
  readonly changes: readonly StandingChange[];
};

const ratedOutcome = (outcome: string | null): StandingChange['outcome'] =>
  outcome === 'affirmative' || outcome === 'negative' ? outcome : 'draw';

export const standingsOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** The seasons a ladder can show: active and closed, newest start first. */
  listLadderSeasons(): Promise<readonly SeasonRecord[]> {
    return instrumented(eventSink, 'listLadderSeasons', async () =>
      (
        await database
          .select()
          .from(seasons)
          .where(ne(seasons.status, 'scheduled'))
          .orderBy(desc(seasons.startsAt))
      ).map(toSeasonRecord),
    );
  },

  /** Formats that rate, by name. */
  listRankedFormats(): Promise<
    readonly { readonly id: string; readonly name: string }[]
  > {
    return instrumented(eventSink, 'listRankedFormats', () =>
      database
        .select({ id: formats.id, name: formats.name })
        .from(formats)
        .where(eq(formats.rankedEligible, true))
        .orderBy(asc(formats.name)),
    );
  },

  /** One format and ladder's ratings and ledger rows in the given seasons. */
  readStandings(input: {
    readonly formatId: string;
    readonly ladder: RatingLadder;
    readonly seasonIds: readonly string[];
  }): Promise<StandingsRead> {
    return instrumented(eventSink, 'readStandings', async () => {
      if (input.seasonIds.length === 0) return { ratings: [], changes: [] };
      const ratingRows = await database
        .select({
          seasonId: ratings.seasonId,
          actorId: ratings.actorId,
          username: users.username,
          rating: ratings.rating,
          deviation: ratings.deviation,
        })
        .from(ratings)
        .innerJoin(actors, eq(actors.id, ratings.actorId))
        .leftJoin(users, eq(users.id, actors.userId))
        .where(
          and(
            eq(ratings.formatId, input.formatId),
            eq(ratings.ladder, input.ladder),
            inArray(ratings.seasonId, [...input.seasonIds]),
          ),
        );
      const changeRows = await database
        .select({
          seasonId: ratingChanges.seasonId,
          actorId: ratingChanges.actorId,
          debateId: ratingChanges.debateId,
          ratingBefore: ratingChanges.ratingBefore,
          ratingAfter: ratingChanges.ratingAfter,
          occurredAt: ratingChanges.occurredAt,
          role: debateParticipants.role,
          outcome: debates.outcome,
        })
        .from(ratingChanges)
        .innerJoin(debates, eq(debates.id, ratingChanges.debateId))
        .innerJoin(
          debateParticipants,
          and(
            eq(debateParticipants.debateId, ratingChanges.debateId),
            eq(debateParticipants.actorId, ratingChanges.actorId),
          ),
        )
        .where(
          and(
            eq(ratingChanges.formatId, input.formatId),
            eq(ratingChanges.ladder, input.ladder),
            inArray(ratingChanges.seasonId, [...input.seasonIds]),
          ),
        )
        .orderBy(asc(ratingChanges.occurredAt));
      return {
        ratings: ratingRows.map((row) => ({
          ...row,
          username: row.username ?? null,
        })),
        changes: changeRows.map((row) => ({
          ...row,
          occurredAt: row.occurredAt.toISOString(),
          role: row.role === 'negative' ? 'negative' : 'affirmative',
          outcome: ratedOutcome(row.outcome),
        })),
      };
    });
  },
});
