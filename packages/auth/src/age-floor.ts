import type { AgeBand } from '@daisy/protocol';
import { ADMITTED_AGE_BANDS } from '@daisy/protocol/age-floor';
import { ageBand } from './age-band';

/**
 * The one trusted floor and its bands are owned by `@daisy/protocol/age-floor`
 * (decision 88: 13), so auth, the database and shared rules read one value.
 */
export {
  ACCOUNT_AGE_FLOOR,
  ADMITTED_AGE_BANDS,
  type AgeFloor,
} from '@daisy/protocol/age-floor';

/** The refusal below the floor; the age step stores nothing for it. */
export type AgeRefusal = 'under-13';

/** What an age-step answer leads to; only `admitted` stores anything. */
export type MemberFloorDecision =
  | { readonly outcome: 'admitted'; readonly band: AgeBand }
  | { readonly outcome: 'refused'; readonly refusal: AgeRefusal };

/**
 * The member floor (`ACCOUNT_AGE_FLOOR`): a birth month (`YYYY-MM`) on the
 * server's own clock is admitted from the month the person turns 13, and
 * refused as under 13 before it. Malformed input or a future month throws VALIDATION
 * (`ageBand`).
 */
export function memberFloorDecision(
  birthMonth: string,
  now: Date,
): MemberFloorDecision {
  const band = ageBand(birthMonth, now);
  return ADMITTED_AGE_BANDS.includes(band)
    ? { outcome: 'admitted', band }
    : { outcome: 'refused', refusal: 'under-13' };
}
