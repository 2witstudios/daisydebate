import { createAppError, createRefusal } from '@daisy/errors';
import { daisyOrganizationId } from './daisy-reference';
import {
  twoSideKeys,
  type DebaterStanding,
  ladderKey,
  type Ladder,
  type PlannedRatingChange,
  type RatingState,
} from '@daisy/protocol';
import { and, desc, eq, inArray, max, ne, sql } from 'drizzle-orm';
import type { RateDebateInput, RateDebateResult } from './rating-facts';
import {
  assertRankedRoundIntegrity,
  projectionLockOrder,
  ratedResult,
  ratingChangeRows,
} from './rating-decisions';
import { readRatingFacts } from './rating-discovery';
import { retryStale } from './retry-stale';
import { seatOfColumns } from './seat-columns';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';
import { ratingChanges, ratings, seasons } from './schema/ratings';
import { inTransaction, type Tx, type TxSource } from './tx';

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
    readonly ladder: Ladder;
    readonly seasonId: string | null;
  },
): Promise<DebaterStanding> {
  const onLadder = and(
    eq(ratings.actorId, scope.actorId),
    eq(ratings.ladder, scope.ladder.style),
    eq(ratings.division, scope.ladder.division),
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
        eq(ratingChanges.ladder, scope.ladder.style),
        eq(ratingChanges.division, scope.ladder.division),
      ),
    );
  if (!current && previous)
    throw createAppError(
      'CONFLICT',
      'Season carry-over requires DEC-111 resolution',
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
    readonly seasonId: string;
    readonly ladder: Ladder;
  },
  change: PlannedRatingChange,
): Promise<void> {
  const written =
    change.expectedVersion === null
      ? await tx
          .insert(ratings)
          .values({
            seasonId: scope.seasonId,
            ladder: scope.ladder.style,
            division: scope.ladder.division,
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
              eq(ratings.ladder, scope.ladder.style),
              eq(ratings.division, scope.ladder.division),
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
  assertRankedRoundIntegrity(round);
  const facts = await readRatingFacts(tx, roundId);
  if (!facts) throw createAppError('NOT_FOUND', 'No such round');
  const eligibility = decide.eligibility(facts);
  // A refusal, not a result: the sweep reports it and retries the Round.
  if (eligibility.kind === 'attendance-unsettled')
    throw createRefusal('CONFLICT', 'attendance-unsettled');
  if (eligibility.kind !== 'rated') return eligibility;

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
          inArray(roundParticipants.side, [...twoSideKeys]),
        ),
      )
  ).map(({ actorId, ...seat }) => ({ actorId, seat: seatOfColumns(seat) }));
  const [season] = await tx
    .select({ id: seasons.id })
    .from(seasons)
    // Daisy's own season on the Round's division: every organization may
    // have an active one per division (ADR 0147).
    .where(
      and(
        eq(seasons.status, 'active'),
        eq(seasons.organizationId, daisyOrganizationId),
        eq(seasons.division, eligibility.ladder.division),
      ),
    )
    .for('share');
  if (!season) throw createAppError('CONFLICT', 'No season is active');
  const seasonId = season.id;
  // Two-int advisory namespace59090 belongs to ratings, disjoint from the
  // bigint command locks. Sort/dedupe actual int32 keys before acquisition;
  // a hash collision only serializes unrelated ladder/actor pairs.
  const keys =
    await tx.execute(sql`select key::text as key from (select distinct
    hashtext(${ladderKey(eligibility.ladder.style, eligibility.ladder.division)} || ':' || actor_id) as key
    from round_participants where round_id=${roundId} and seat_kind='side' and side in (${sql.join(
      twoSideKeys.map((side) => sql`${side}`),
      sql`, `,
    )})) locks
    order by locks.key`);
  for (const { key } of keys as unknown as { key: string }[])
    await tx.execute(sql`select pg_advisory_xact_lock(59090, ${key}::integer)`);
  const standings: Record<string, DebaterStanding> = {};
  for (const { actorId } of seats)
    standings[actorId] = await loadStanding(tx, {
      actorId,
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
  database: TxSource,
  input: RateDebateInput,
): Promise<RateDebateResult> {
  return retryStale(
    () => inTransaction(database, (tx) => rateOnce(tx, input)),
    (error) => error instanceof StaleProjection,
    ATTEMPTS,
    () =>
      createAppError(
        'CONFLICT',
        'Ratings kept changing while this round was rated',
      ),
  );
}
