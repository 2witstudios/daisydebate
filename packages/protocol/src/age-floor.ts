import type { AgeBand } from './ladder';

/** The youngest age, in whole years, an account may be opened at. */
export type AgeFloor = 13;

/**
 * The one trusted floor: members must be 13 or older (owner 2026-11-18,
 * decision 88, amending DEC-244's beta floor of 16). Under 13 is never
 * admitted (COPPA: Daisy is not directed to children under 13). It lives
 * here so auth, the database and every shared rule read the same value;
 * change it here and nowhere else.
 */
export const ACCOUNT_AGE_FLOOR: AgeFloor = 13;

/** Age bands at or above each account floor. */
const bandsAtFloor: Record<AgeFloor, readonly AgeBand[]> = {
  13: ['13-15', '16-17', 'adult'],
};

/** The bands the account floor admits now, for a read that filters in SQL. */
export const ADMITTED_AGE_BANDS: readonly AgeBand[] =
  bandsAtFloor[ACCOUNT_AGE_FLOOR];

/** Whether a durable age band (or a string read from storage) meets the floor; none never does. */
export const ageBandAdmitted = (band: string | null): boolean =>
  band !== null && (ADMITTED_AGE_BANDS as readonly string[]).includes(band);
