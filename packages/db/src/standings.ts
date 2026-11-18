import { createAppError } from '@daisy/errors';
import {
  ratingStyles,
  twoSideKeys,
  type Ladder,
  type TwoSideKey,
  type WinnerOutcome,
} from '@daisy/protocol';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { isDebatingSeatSql } from './seat-columns';
import { actors } from './schema/actors';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';
import { formatPresets } from './schema/format-presets';
import { formats } from './schema/formats';
import { ratingChanges, ratings } from './schema/ratings';
import { users } from './schema/users';
import { listSeasonRecords, type SeasonRecord } from './season-record';
import { factReleasedSql, type SpectatorClock } from './spectator-release-sql';
import { releasedStandings } from './standings-release';

/**
 * The leaderboard's reads (ADR 0055): the seasons a ladder can show, the
 * ranked formats, and one format and ladder's rows for a set of seasons.
 * Rows only: what they add up to (record, movement, rank) is the feature's
 * pure `summarizeStandings`.
 */

/** A debater's current state on the ladder in one season. */
export type StandingRating = {
  readonly seasonId: string;
  readonly actorId: string;
  /** Null for an actor with no account. */
  readonly username: string | null;
  /** The account is closed; its name stays on the ladder (ADR 0087). */
  readonly accountClosed: boolean;
  readonly rating: number;
  readonly deviation: number;
  readonly volatility: number;
};

/** One ledger posting, with the debater's side and the debate's winning side. */
export type StandingChange = {
  readonly seasonId: string;
  readonly actorId: string;
  readonly roundId: string;
  readonly ratingBefore: number;
  readonly ratingAfter: number;
  readonly deviationBefore: number;
  readonly deviationAfter: number;
  readonly occurredAt: string;
  /** A rating compares the two sides (ADR 0055): the preset's pair. */
  readonly side: TwoSideKey;
  readonly outcome: WinnerOutcome;
};

export type StandingsRead = {
  readonly ratings: readonly StandingRating[];
  readonly changes: readonly StandingChange[];
};

const isTwoSideKey = (key: string | null): key is TwoSideKey =>
  (twoSideKeys as readonly (string | null)[]).includes(key);

/**
 * A posting's side and outcome as a rated result. A ledger row is only ever
 * written for a debater's side of a Round a side won, so anything else is
 * corrupt data and is refused rather than guessed.
 */
function ratedSeat(
  side: string | null,
  winningSide: string | null,
): Pick<StandingChange, 'side' | 'outcome'> {
  if (!isTwoSideKey(side) || !isTwoSideKey(winningSide))
    throw createAppError(
      'INTERNAL',
      'A ledger posting has no rated seat or outcome',
    );
  return { side, outcome: { kind: 'winner', side: winningSide } };
}

export const standingsOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** Ratings hidden from a member until their current judging assignment is ruled. */
  async readRatingBlindings(viewerActorId: string): Promise<readonly string[]> {
    const rows =
      await database.execute(sql`select distinct opponent.actor_id from round_participants judge
      join rounds r on r.id=judge.round_id
      join round_participants opponent on opponent.round_id=r.id and ${isDebatingSeatSql(sql`opponent.seat_kind`)}
      where judge.actor_id=${viewerActorId} and judge.seat_kind='judge' and r.status in ('opening','active')
      and not exists(select 1 from ballots b where b.judge_participant_id=judge.id)`);
    return (rows as unknown as { actor_id: string }[]).map(
      (row) => row.actor_id,
    );
  },

  /** The seasons a ladder can show, newest start first. */
  listLadderSeasons(): Promise<readonly SeasonRecord[]> {
    return instrumented(eventSink, 'listLadderSeasons', () =>
      listSeasonRecords(database),
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
            eq(formatPresets.rankedEligible, true),
            eq(formatPresets.formatVersion, formats.currentVersion),
            inArray(formats.id, [...ratingStyles]),
          ),
        )
        .orderBy(asc(formats.name)),
    );
  },

  /**
   * One ladder's (style and division) ratings and ledger rows in the given seasons, as
   * the audience may know them at `now`: a posting waits for its Round's
   * spectator timeline, and a rating stands where its last released posting
   * left it. `revealRoundId` names a Round the caller already holds an
   * authorized read of, whose own postings need no wait.
   */
  readStandings(input: {
    readonly ladder: Ladder;
    readonly seasonIds: readonly string[];
    readonly clock: SpectatorClock;
    readonly revealRoundId?: string;
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
              closedAt: users.deletedAt,
              rating: ratings.rating,
              deviation: ratings.deviation,
              volatility: ratings.volatility,
            })
            .from(ratings)
            .innerJoin(actors, eq(actors.id, ratings.actorId))
            .leftJoin(users, eq(users.id, actors.userId))
            .where(
              and(
                eq(ratings.ladder, input.ladder.style),
                eq(ratings.division, input.ladder.division),
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
              deviationBefore: ratingChanges.deviationBefore,
              deviationAfter: ratingChanges.deviationAfter,
              volatilityBefore: ratingChanges.volatilityBefore,
              occurredAt: ratingChanges.occurredAt,
              side: roundParticipants.side,
              winningSide: rounds.winningSide,
              released: sql<boolean>`${factReleasedSql(
                sql`greatest(${ratingChanges.occurredAt},${rounds.completedAt})`,
                rounds,
                input.clock,
              )}`,
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
                eq(ratingChanges.ladder, input.ladder.style),
                eq(ratingChanges.division, input.ladder.division),
                inArray(ratingChanges.seasonId, [...input.seasonIds]),
                eq(roundParticipants.seatKind, 'side'),
                inArray(roundParticipants.side, [...twoSideKeys]),
              ),
            ),
        }),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
      return releasedStandings({
        ratings: ratingRows.map(({ closedAt, ...row }) => ({
          ...row,
          username: row.username ?? null,
          accountClosed: closedAt !== null,
        })),
        changes: changeRows.map(
          ({ released, volatilityBefore, side, winningSide, ...row }) => ({
            ...row,
            occurredAt: row.occurredAt.toISOString(),
            ...ratedSeat(side, winningSide),
            released: released || row.roundId === input.revealRoundId,
            volatilityBefore,
          }),
        ),
      });
    });
  },
});
