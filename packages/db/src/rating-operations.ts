import { createAppError } from '@daisy/errors';
import {
  debateSides,
  type DebaterStanding,
  type PlannedRatingChange,
  type RatingLadder,
  type RatingState,
} from '@daisy/protocol';
import { and, desc, eq, inArray, max, ne, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { RateDebateInput, RateDebateResult } from './rating-facts';
import {
  assertRatedRoundIntegrity,
  projectionLockOrder,
  ratedResult,
  ratingChangeRows,
  retryStaleProjection,
} from './rating-decisions';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';
import { ratingChanges, ratings, seasons } from './schema/ratings';

/**
 * Rates one completed round (ADR 0055, ADR 0058) as a thin transactional
 * shell: it locks the round, asserts its frozen integrity, asks the
 * injected domain decision (`@daisy/debate-engine`'s decision, composed by
 * the caller because an adapter never decides domain rules) and writes what
 * it decides. Two ledger rows and both projections commit together or not
 * at all; a rerun finds the ledger rows and writes nothing; a projection
 * that moved under a concurrent write is retried from fresh facts.
 */

type Tx = Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0];

/** A projection moved under a concurrent debate: retry from fresh facts. */
class StaleProjection extends Error {}

const ATTEMPTS = 3;

const stateOf = (row: RatingState): RatingState => ({
  rating: row.rating,
  deviation: row.deviation,
  volatility: row.volatility,
});

async function loadStanding(
  tx: Tx,
  scope: {
    readonly actorId: string;
    readonly formatId: string;
    readonly ladder: RatingLadder;
    readonly seasonId: string | null;
  },
): Promise<DebaterStanding> {
  const onLadder = and(
    eq(ratings.actorId, scope.actorId),
    eq(ratings.formatId, scope.formatId),
    eq(ratings.ladder, scope.ladder),
  );
  const [current] =
    scope.seasonId === null
      ? []
      : await tx
          .select()
          .from(ratings)
          .where(and(onLadder, eq(ratings.seasonId, scope.seasonId)));
  const [previous] = await tx
    .select({
      rating: ratings.rating,
      deviation: ratings.deviation,
      volatility: ratings.volatility,
    })
    .from(ratings)
    .innerJoin(seasons, eq(seasons.id, ratings.seasonId))
    .where(
      scope.seasonId === null
        ? onLadder
        : and(onLadder, ne(ratings.seasonId, scope.seasonId)),
    )
    .orderBy(desc(seasons.startsAt))
    .limit(1);
  const [last] = await tx
    .select({ at: max(ratingChanges.occurredAt) })
    .from(ratingChanges)
    .where(
      and(
        eq(ratingChanges.actorId, scope.actorId),
        eq(ratingChanges.formatId, scope.formatId),
        eq(ratingChanges.ladder, scope.ladder),
      ),
    );
  return {
    current: current
      ? { state: stateOf(current), version: current.version }
      : null,
    previous: previous ? stateOf(previous) : null,
    lastRatedAt: last?.at?.toISOString() ?? null,
  };
}

async function writeProjection(
  tx: Tx,
  scope: {
    readonly formatId: string;
    readonly seasonId: string;
    readonly ladder: RatingLadder;
  },
  change: PlannedRatingChange,
): Promise<void> {
  const written =
    change.expectedVersion === null
      ? await tx
          .insert(ratings)
          .values({ ...scope, actorId: change.actorId, ...change.after })
          .onConflictDoNothing()
          .returning({ version: ratings.version })
      : await tx
          .update(ratings)
          .set({
            ...change.after,
            updatedAt: sql`now()`,
            version: sql`${ratings.version} + 1`,
          })
          .where(
            and(
              eq(ratings.actorId, change.actorId),
              eq(ratings.formatId, scope.formatId),
              eq(ratings.seasonId, scope.seasonId),
              eq(ratings.ladder, scope.ladder),
              eq(ratings.version, change.expectedVersion),
            ),
          )
          .returning({ version: ratings.version });
  if (written.length !== 1) throw new StaleProjection();
}

async function rateOnce(
  tx: Tx,
  { roundId, changeIds, decide }: RateDebateInput,
): Promise<RateDebateResult> {
  const [round] = await tx
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .for('no key update');
  if (!round) throw createAppError('NOT_FOUND', 'No such round');
  assertRatedRoundIntegrity(round);
  const [rated] = await tx
    .select({ id: ratingChanges.id })
    .from(ratingChanges)
    .where(eq(ratingChanges.roundId, roundId))
    .limit(1);
  const eligibility = decide.eligibility({
    competitionType: round.competitionType,
    ladderId: round.ladderId,
    status: round.status,
    outcome: round.outcome,
    completedAt: round.completedAt?.toISOString() ?? null,
    alreadyRated: rated !== undefined,
  });
  if (eligibility.kind !== 'rated') return eligibility;

  const seats = await tx
    .select({
      actorId: roundParticipants.actorId,
      role: roundParticipants.role,
    })
    .from(roundParticipants)
    .where(
      and(
        eq(roundParticipants.roundId, roundId),
        inArray(roundParticipants.role, [...debateSides]),
      ),
    );
  const [season] = await tx
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.status, 'active'))
    .for('share');
  const seasonId = season?.id ?? null;
  const standings: Record<string, DebaterStanding> = {};
  for (const { actorId } of seats)
    standings[actorId] = await loadStanding(tx, {
      actorId,
      formatId: round.formatId,
      ladder: eligibility.ladder,
      seasonId,
    });

  const plan = decide.plan({
    ladder: eligibility.ladder,
    outcome: eligibility.outcome,
    occurredAt: eligibility.occurredAt,
    seasonId,
    seats,
    standings,
    changeIds,
  });
  const scope = {
    formatId: round.formatId,
    seasonId: plan.seasonId,
    ladder: plan.ladder,
  };
  await tx
    .insert(ratingChanges)
    .values(ratingChangeRows(plan, { roundId, formatId: round.formatId }));
  for (const change of projectionLockOrder(plan.changes))
    await writeProjection(tx, scope, change);
  return ratedResult(plan);
}

export async function rateCompletedRound(
  database: BunSQLDatabase,
  input: RateDebateInput,
): Promise<RateDebateResult> {
  return retryStaleProjection(
    () => database.transaction((tx) => rateOnce(tx, input)),
    (error) => error instanceof StaleProjection,
    ATTEMPTS,
  );
}
