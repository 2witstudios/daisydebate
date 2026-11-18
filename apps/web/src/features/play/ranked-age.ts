import { RANKED_AGE_FLOOR } from '@daisy/auth/age-floor';

/** Why ranked play is closed to a member under the ranked floor (decision 79). */
export const rankedAgeTitle = `Ranked play is for members ${RANKED_AGE_FLOOR} and over.`;
export const rankedAgeComing = `A Scholastic ladder for members under ${RANKED_AGE_FLOOR} is coming.`;
/** The same reason as one line, where a refusal or a hint has one line. */
export const rankedAgeReason = `${rankedAgeTitle} ${rankedAgeComing}`;
