import type { AgeBand } from '@daisy/protocol';
import { ageBand } from './age-band';

/** The youngest age, in whole years, an account may be opened at. */
export type AgeFloor = 13;

/**
 * The one trusted floor the age step enforces: members must be 13 or older
 * (owner 2026-11-18, decision 88, amending DEC-244's beta floor of 16).
 * Under 13 is never admitted (COPPA: Daisy is not directed to children under
 * 13). Change it here and nowhere else.
 */
export const ACCOUNT_AGE_FLOOR: AgeFloor = 13;

/** Age bands at or above each account floor. */
const bandsAtFloor: Record<AgeFloor, readonly AgeBand[]> = {
  13: ['13-15', '16-17', 'adult'],
};

/** The bands the account floor admits now, for a read that filters in SQL. */
export const ADMITTED_AGE_BANDS: readonly AgeBand[] =
  bandsAtFloor[ACCOUNT_AGE_FLOOR];

/** The refusal below the floor; the age step stores nothing for it. */
export type AgeRefusal = 'under-13';

/** What an age-step answer leads to; only `admitted` stores anything. */
export type MemberFloorDecision =
  | { readonly outcome: 'admitted'; readonly band: AgeBand }
  | { readonly outcome: 'refused'; readonly refusal: AgeRefusal };

/**
 * The member floor: a birth month (`YYYY-MM`) on the server's own clock is
 * admitted from the month the person turns the floor, and refused as under
 * 13 before it. Malformed input or a future month throws VALIDATION
 * (`ageBand`).
 */
export function memberFloorDecision(
  birthMonth: string,
  now: Date,
  floor: AgeFloor = ACCOUNT_AGE_FLOOR,
): MemberFloorDecision {
  const band = ageBand(birthMonth, now);
  return bandsAtFloor[floor].includes(band)
    ? { outcome: 'admitted', band }
    : { outcome: 'refused', refusal: 'under-13' };
}
