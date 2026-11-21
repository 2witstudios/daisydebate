import { createAppError, createRefusal } from '@daisy/errors';
import {
  type DebaterStanding,
  type RoundRatingScope,
  type PlannedRatingChange,
  type RatingState,
} from '@daisy/protocol';
import { and, eq, inArray, max, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { RateDebateInput, RateDebateResult } from './rating-facts';
import {
  assertRoundRatingIntegrity,
  projectionLockOrder,
  ratedResult,
  ratingChangeRows,
} from './rating-decisions';
import { readRatingFacts } from './rating-discovery';
import { retryStale } from './retry-stale';
import { seatOfColumns } from './seat-columns';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';
import { ratingChanges, ratings } from './schema/ratings';
import { scopeTransaction } from './tenant-scope';

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
    readonly pool: NonNullable<RoundRatingScope>;
  },
): Promise<DebaterStanding> {
  const onLadder = and(
    eq(ratings.actorId, scope.actorId),
    eq(ratings.ladder, scope.pool.ladderId),
  );
  const [current] = await tx
    .select()
    .from(ratings)
    .where(and(onLadder, eq(ratings.seasonId, scope.pool.seasonId)));
  const [last] = await tx
    .select({ at: max(ratingChanges.occurredAt) })
    .from(ratingChanges)
    .where(
      and(
        eq(ratingChanges.actorId, scope.actorId),
        eq(ratingChanges.ladder, scope.pool.ladderId),
        eq(ratingChanges.seasonId, scope.pool.seasonId),
      ),
    );
  return {
    current: current
      ? { state: stateOf(current), version: current.version }
      : null,
    previous: null,
    lastRatedAt: last?.at?.toISOString() ?? null,
  };
}

async function writeProjection(
  tx: Tx,
  scope: NonNullable<RoundRatingScope>,
  change: PlannedRatingChange,
): Promise<void> {
  const written =
    change.expectedVersion === null
      ? await tx
          .insert(ratings)
          .values({
            seasonId: scope.seasonId,
            ladder: scope.ladderId,
            lobbyId: scope.lobbyId,
            actorId: change.actorId,
            ...change.after,
          })
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
              eq(ratings.seasonId, scope.seasonId),
              eq(ratings.ladder, scope.ladderId),
              eq(ratings.version, change.expectedVersion),
            ),
          )
          .returning({ version: ratings.version });
  if (written.length !== 1) throw new StaleProjection();
}

async function rateOnce(
  tx: Tx,
  { roundId, nextChangeId, decide }: RateDebateInput,
): Promise<RateDebateResult> {
  const [round] = await tx
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .for('no key update');
  if (!round) throw createAppError('NOT_FOUND', 'No such round');
  assertRoundRatingIntegrity(round);
  if (round.ratingLobbyId !== null)
    await scopeTransaction(tx, { lobbyId: round.ratingLobbyId });
  const facts = await readRatingFacts(tx, roundId);
  if (!facts) throw createAppError('NOT_FOUND', 'No such round');
  const eligibility = decide.eligibility(facts);
  // A refusal, not a result: the sweep reports it and retries the Round.
  if (eligibility.kind === 'attendance-unsettled')
    throw createRefusal('CONFLICT', 'attendance-unsettled');
  if (eligibility.kind !== 'rated') return eligibility;

  const [first, second] = round.rulesSnapshot.sides;
  if (round.rulesSnapshot.sides.length !== 2 || !first || !second)
    return { kind: 'unrated', reason: 'competition' };
  const sides = [first.key, second.key] as const;
  // A rating compares the two sides' seats (ADR 0055): the preset's pair.
  const seats = (
    await tx
      .select({
        actorId: roundParticipants.actorId,
        seatKind: roundParticipants.seatKind,
        side: roundParticipants.side,
        slot: roundParticipants.slot,
      })
      .from(roundParticipants)
      .where(
        and(
          eq(roundParticipants.roundId, roundId),
          eq(roundParticipants.seatKind, 'side'),
          inArray(roundParticipants.side, [...sides]),
        ),
      )
  ).map(({ actorId, ...seat }) => ({ actorId, seat: seatOfColumns(seat) }));
  // Two-int advisory namespace59090 belongs to ratings, disjoint from the
  // bigint command locks. Sort/dedupe actual int32 keys before acquisition;
  // a hash collision only serializes unrelated ladder/actor pairs.
  const keys =
    await tx.execute(sql`select key::text as key from (select distinct
    hashtext(${eligibility.scope.ladderId} || ':' || ${eligibility.scope.seasonId} || ':' || actor_id) as key
    from round_participants where round_id=${roundId} and seat_kind='side' and side in (${sql.join(
      sides.map((side) => sql`${side}`),
      sql`, `,
    )})) locks
    order by locks.key`);
  for (const { key } of keys as unknown as { key: string }[])
    await tx.execute(sql`select pg_advisory_xact_lock(59090, ${key}::integer)`);
  const standings: Record<string, DebaterStanding> = {};
  for (const { actorId } of seats)
    standings[actorId] = await loadStanding(tx, {
      actorId,
      pool: eligibility.scope,
    });

  const plan = decide.plan({
    scope: eligibility.scope,
    sides,
    outcome: eligibility.outcome,
    occurredAt: eligibility.occurredAt,
    seats,
    standings,
    changeIds: Object.fromEntries(
      seats.map(({ actorId }) => [actorId, nextChangeId()]),
    ),
  });
  await tx
    .insert(ratingChanges)
    .values(ratingChangeRows(plan, { roundId, formatId: round.formatId }));
  for (const change of projectionLockOrder(plan.changes))
    await writeProjection(tx, plan.scope, change);
  return ratedResult(plan);
}

export async function rateCompletedRound(
  database: BunSQLDatabase,
  input: RateDebateInput,
): Promise<RateDebateResult> {
  return retryStale(
    () => database.transaction((tx) => rateOnce(tx, input)),
    (error) => error instanceof StaleProjection,
    ATTEMPTS,
    () =>
      createAppError(
        'CONFLICT',
        'Ratings kept changing while this round was rated',
      ),
  );
}
