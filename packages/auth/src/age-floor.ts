import type { AgeBand } from './age-band';

/** The youngest age, in whole years, an account may be opened at. */
export type AgeFloor = 13 | 16;

/**
 * The one trusted floor the age step enforces. DEC-106: the beta is open to
 * people 16 and older; after the beta the product floor is 13. Change it
 * here and nowhere else.
 */
export const ACCOUNT_AGE_FLOOR: AgeFloor = 16;

/**
 * The one trusted floor for ranked play, in whole years (owner decision 79):
 * ranked Rounds are published and licensed to Daisy, which a minor cannot
 * agree to alone. Membership keeps ACCOUNT_AGE_FLOOR; a member between the
 * two plays casual only. Its type pins it to the band edge the rule below
 * reads, so a different floor fails to compile until a band edge matches it.
 */
export const RANKED_AGE_FLOOR = 18 as const;

/**
 * Whether a durable age band, computed on the Round's instant, meets the
 * ranked floor. 18 is the top band's edge (`ageBand`'s 216 months), so it is
 * the adult band; a floor between edges would need a band edge first. No
 * record never does.
 */
export const rankedAgeAdmitted = (band: AgeBand | null): boolean =>
  band === 'adult';

/** What an age-step answer leads to; only `accept` stores anything. */
export type AgeStepDecision = 'accept' | 'under-13' | 'below-floor';

/**
 * Under 13 is refused for good; between 13 and the floor is refused only
 * while the floor is above 13 (the beta). Both store nothing.
 */
export function ageStepDecision(
  band: AgeBand,
  floor: AgeFloor,
): AgeStepDecision {
  if (band === 'under-13') return 'under-13';
  if (band === '13-15' && floor === 16) return 'below-floor';
  return 'accept';
}
