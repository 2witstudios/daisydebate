import { RANKED_DELAY_SECONDS } from '@daisy/debate-engine';

/** The read instant and the ranked delay in force, as the database's list reads take them. */
export const spectatorClockAt = (now: string) => ({
  now,
  rankedDelaySeconds: RANKED_DELAY_SECONDS,
});
