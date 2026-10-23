import { createAppError, createInvariantError } from '@daisy/errors';
import type { RatingPlan } from '@daisy/protocol';
import type { RateDebateResult } from './rating-facts';

/**
 * Rated-round integrity (ADR 0058 §8): corruption protection on frozen
 * columns, never a decision. A ranked round carries a preset version whose
 * provenance the composite FK proves structurally; if any of that fails
 * here the round was corrupted after creation, and the failure is an
 * invariant, not an `{ kind: 'unrated', reason: … }`.
 */
export function assertRatedRoundIntegrity(round: {
  readonly competitionType: string;
  readonly presetVersion: unknown;
  readonly ladderId: string | null;
}): void {
  if (round.competitionType === 'ranked') {
    if (round.presetVersion === null || round.ladderId === null)
      throw createInvariantError(
        'round.rating.integrity',
        'A ranked round pins its preset and ladder',
      );
    return;
  }
  if (round.presetVersion !== null || round.ladderId !== null)
    throw createInvariantError(
      'round.rating.integrity',
      'Only a ranked round carries a preset or a ladder',
    );
}

/** Ledger rows for one plan, both written in the same transaction. */
export const ratingChangeRows = (
  plan: RatingPlan,
  scope: { readonly roundId: string; readonly formatId: string },
) =>
  plan.changes.map((change) => ({
    formatId: scope.formatId,
    seasonId: plan.seasonId,
    ladder: plan.ladder,
    id: change.changeId,
    roundId: scope.roundId,
    actorId: change.actorId,
    ratingBefore: change.before.rating,
    ratingAfter: change.after.rating,
    deviationBefore: change.before.deviation,
    deviationAfter: change.after.deviation,
    volatilityBefore: change.before.volatility,
    volatilityAfter: change.after.volatility,
    calculationVersion: plan.calculationVersion,
    occurredAt: new Date(plan.occurredAt),
  }));

/**
 * Stable actor order: two rounds between the same pair with sides swapped
 * would otherwise lock the two projections in opposite orders and deadlock.
 */
export const projectionLockOrder = <C extends { readonly actorId: string }>(
  changes: readonly C[],
): C[] =>
  [...changes].sort((a, b) =>
    a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0,
  );

export const ratedResult = (plan: RatingPlan): RateDebateResult => ({
  kind: 'rated',
  ladder: plan.ladder,
  seasonId: plan.seasonId,
  changes: plan.changes.map(({ changeId, actorId, before, after }) => ({
    id: changeId,
    actorId,
    before,
    after,
  })),
});

/** Retries only a projection that moved under a concurrent write, then refuses. */
export async function retryStaleProjection<T>(
  attempt: () => Promise<T>,
  isStale: (error: unknown) => boolean,
  attempts: number,
): Promise<T> {
  for (let tried = 1; ; tried += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!isStale(error)) throw error;
      if (tried >= attempts)
        throw createAppError(
          'CONFLICT',
          'Ratings kept changing while this round was rated',
        );
    }
  }
}
