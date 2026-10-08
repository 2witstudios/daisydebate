import { createAppError } from '@daisy/errors';
import { debateSides, type RatingLadder } from '@daisy/protocol';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { actors } from './schema/actors';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';
import { formatPresets } from './schema/format-presets';
import { formats } from './schema/formats';
import { ratingChanges, ratings, seasons } from './schema/ratings';
import { users } from './schema/users';
import { toSeasonRecord, type SeasonRecord } from './season-record';

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
  readonly roundId: string;
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

/**
 * A posting's seat and outcome as a rated result. A ledger row is only ever
 * written for a debater's side of a decided debate, so anything else is
 * corrupt data and is refused rather than guessed.
 */
function ratedSeat(
  role: string,
  outcome: string | null,
): Pick<StandingChange, 'role' | 'outcome'> {
  const side = role === 'affirmative' || role === 'negative' ? role : null;
  const result =
    outcome === 'affirmative' || outcome === 'negative' || outcome === 'draw'
      ? outcome
      : null;
  if (side === null || result === null)
    throw createAppError(
      'INTERNAL',
      'A ledger posting has no rated seat or outcome',
    );
  return { role: side, outcome: result };
}

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

  /**
   * Formats that rate, by name: the ones with a current approved preset.
   * Ranked availability is constructed from presets (ADR 0058 §4), so a
   * format without one never reaches a ladder.
   */
  listRankedFormats(): Promise<
    readonly { readonly id: string; readonly name: string }[]
  > {
    return instrumented(eventSink, 'listRankedFormats', () =>
      database
        .selectDistinct({ id: formats.id, name: formats.name })
        .from(formats)
        .innerJoin(
          formatPresets,
          and(
            eq(formatPresets.formatId, formats.id),
            isNull(formatPresets.supersededAt),
          ),
        )
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
      // One snapshot: a rating committed between the two selects must not
      // appear in one set and not the other.
      const { ratingRows, changeRows } = await database.transaction(
        async (tx) => ({
          ratingRows: await tx
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
            ),
          changeRows: await tx
            .select({
              seasonId: ratingChanges.seasonId,
              actorId: ratingChanges.actorId,
              roundId: ratingChanges.roundId,
              ratingBefore: ratingChanges.ratingBefore,
              ratingAfter: ratingChanges.ratingAfter,
              occurredAt: ratingChanges.occurredAt,
              role: roundParticipants.role,
              outcome: rounds.outcome,
            })
            .from(ratingChanges)
            .innerJoin(rounds, eq(rounds.id, ratingChanges.roundId))
            .innerJoin(
              roundParticipants,
              and(
                eq(roundParticipants.roundId, ratingChanges.roundId),
                eq(roundParticipants.actorId, ratingChanges.actorId),
              ),
            )
            .where(
              and(
                eq(ratingChanges.formatId, input.formatId),
                eq(ratingChanges.ladder, input.ladder),
                inArray(ratingChanges.seasonId, [...input.seasonIds]),
                inArray(roundParticipants.role, [...debateSides]),
              ),
            ),
        }),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
      return {
        ratings: ratingRows.map((row) => ({
          ...row,
          username: row.username ?? null,
        })),
        changes: changeRows.map((row) => ({
          ...row,
          occurredAt: row.occurredAt.toISOString(),
          ...ratedSeat(row.role, row.outcome),
        })),
      };
    });
  },
});
