import { sql, type SQL } from 'drizzle-orm';

/**
 * Rounds' published reads for what a Round's notifications name (ADR 0143).
 * `round` names the `rounds` row in the reader's query.
 */

/** Under way: the debate's clock is running. */
export const roundUnderway = (round: SQL) => sql`(${round}.status='active')`;

/** Decided: its result and ballots can be read. */
export const roundDecisionReleased = (round: SQL) =>
  sql`(${round}.status='completed')`;
