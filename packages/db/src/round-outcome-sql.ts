import type { RoundOutcome } from '@daisy/protocol/round-outcome';
import { sql, type SQL } from 'drizzle-orm';

/**
 * The SQL spelling of `outcomeOfColumns` over a Round row aliased `round`
 * (TAB-6.2): its winning side's win, its ranking's places of the subject its
 * frozen rules rank, or null for no result. A raw read selects this as the
 * protocol `RoundOutcome` JSON.
 */
export const roundOutcomeSql = (round: string): SQL =>
  sql.raw(`case
    when ${round}.winning_side is not null then jsonb_build_object('kind', 'winner', 'side', ${round}.winning_side)
    when ${round}.ranking is not null then jsonb_build_object('kind', 'ranking', 'of', ${round}.rules_snapshot->'outcome'->'of', 'places', ${round}.ranking)
  end`);

/** An outcome as plain JSON for a stored receipt: places copied out of their read-only arrays. */
export const outcomeJson = (outcome: RoundOutcome | null) =>
  outcome?.kind === 'ranking'
    ? { ...outcome, places: outcome.places.map((place) => [...place]) }
    : outcome;
