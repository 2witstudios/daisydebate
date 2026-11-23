import { createAppError } from '@daisy/errors';
import type { RoundOutcome } from '@daisy/protocol/round-outcome';
import type { RoundRules } from '@daisy/protocol/format';
import type { SideKey } from '@daisy/protocol/seats';
import type { rounds } from './schema/rounds';

/**
 * A Round's outcome as its row stores it (TAB-6.2): the winning side, or a
 * ranking's places; `rounds_outcome_check` holds at most one. A ranking's
 * subject (sides or speakers) is the frozen rules' outcome, so it is not
 * stored twice.
 */
export type OutcomeColumns = {
  readonly winningSide: SideKey | null;
  readonly ranking: readonly (readonly string[])[] | null;
};

/** The outcome a Round row holds, read against its frozen rules. */
export const outcomeOfColumns = (
  row: OutcomeColumns,
  rules: Pick<RoundRules, 'outcome'>,
): RoundOutcome | null => {
  if (row.winningSide !== null && row.ranking !== null)
    throw createAppError('INVARIANT', 'A Round has one outcome');
  if (row.winningSide !== null)
    return { kind: 'winner', side: row.winningSide };
  if (row.ranking === null) return null;
  if (rules.outcome.kind !== 'ranking')
    throw createAppError('INVARIANT', 'Only a ranking Round stores places');
  return { kind: 'ranking', of: rules.outcome.of, places: row.ranking };
};

/** The columns an outcome is stored in. */
export const columnsOfOutcome = (
  outcome: RoundOutcome | null,
): Required<Pick<typeof rounds.$inferInsert, 'winningSide' | 'ranking'>> => ({
  winningSide: outcome?.kind === 'winner' ? outcome.side : null,
  ranking:
    outcome?.kind === 'ranking'
      ? outcome.places.map((place) => [...place])
      : null,
});
