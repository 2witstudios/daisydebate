import type { AgeBand } from './age-band';

/** The youngest age, in whole years, an account may be opened at. */
export type AgeFloor = 13 | 16;

/**
 * The one trusted floor the age step enforces. DEC-106: the beta is open to
 * people 16 and older; after the beta the product floor is 13. Change it
 * here and nowhere else.
 */
export const ACCOUNT_AGE_FLOOR: AgeFloor = 16;

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
