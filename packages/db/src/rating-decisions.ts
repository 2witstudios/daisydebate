import { createInvariantError } from '@daisy/errors';
import type { RatingPlan } from '@daisy/protocol/ratings';
import type { RateDebateResult } from './rating-facts';

/** Validate the frozen pool before calculating a posting. */
export function assertRoundRatingIntegrity(round: {
  readonly competitionType: string;
  readonly presetVersion: unknown;
  readonly ratingLobbyId: string | null;
  readonly ladderId: string | null;
  readonly seasonId: string | null;
}): void {
  const poolKeys = [round.ratingLobbyId, round.ladderId, round.seasonId];
  const ranked = round.competitionType === 'ranked';
  if (
    ranked !== (round.presetVersion !== null) ||
    (poolKeys.some((key) => key === null) &&
      (ranked || poolKeys.some((key) => key !== null)))
  )
    throw createInvariantError(
      'round.rating.integrity',
      'The frozen rating pool and preset must match the Round',
    );
}

/** Ledger rows for one plan, both written in the same transaction. */
export const ratingChangeRows = (
  plan: RatingPlan,
  scope: { readonly roundId: string; readonly formatId: string },
) =>
  plan.changes.map((change) => ({
    formatId: scope.formatId,
    seasonId: plan.scope.seasonId,
    ladder: plan.scope.ladderId,
    lobbyId: plan.scope.lobbyId,
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
  scope: plan.scope,
  changes: plan.changes.map(({ changeId, actorId, before, after }) => ({
    id: changeId,
    actorId,
    before,
    after,
  })),
});
