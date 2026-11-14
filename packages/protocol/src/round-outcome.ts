import { z } from 'zod';
import { sideKeySchema, type SideKey } from './seats';

/**
 * What a Round decided (TAB-6.2): the side that won, or a ranking of the
 * sides or the speakers, best place first, where a place may be shared. No
 * result is null: a tie, a split panel, or an ending with no winner (DEC-277).
 * Abandonment is a status, not an outcome.
 */
export const roundOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('winner'), side: sideKeySchema }),
  z.strictObject({
    kind: z.literal('ranking'),
    of: z.enum(['sides', 'speakers']),
    /** Side keys or round participant ids, one group per place. */
    places: z
      .array(z.array(z.string().min(1).max(64)).min(1).readonly())
      .min(1)
      .readonly(),
  }),
]);
export type RoundOutcome =
  | { readonly kind: 'winner'; readonly side: SideKey }
  | {
      readonly kind: 'ranking';
      readonly of: 'sides' | 'speakers';
      readonly places: readonly (readonly string[])[];
    };
export type WinnerOutcome = Extract<RoundOutcome, { kind: 'winner' }>;

/** A side's win. */
export const winnerOutcome = (side: SideKey): WinnerOutcome => ({
  kind: 'winner',
  side,
});

/** Only a winner is rateable: a rating compares two sides (ADR 0055). */
export const rateableOutcome = (
  outcome: RoundOutcome | null,
): WinnerOutcome | null => (outcome?.kind === 'winner' ? outcome : null);

/** The winning side, or null when the outcome named none. */
export const winningSideOf = (outcome: RoundOutcome | null): SideKey | null =>
  outcome?.kind === 'winner' ? outcome.side : null;
