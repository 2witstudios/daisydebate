import { roundStatus } from '@daisy/protocol/round';
import { lifecycleSql } from './lifecycle-sql';
import { sql, type SQL } from 'drizzle-orm';

/**
 * Rounds' published reads for what a Round's notifications name (ADR 0144).
 * `round` names the `rounds` row in the reader's query.
 */

/** Under way: the debate's clock is running. */
export const roundUnderway = (round: SQL) =>
  sql`(${round}.status=${lifecycleSql(roundStatus.active)})`;

/** Decided: its result and ballots can be read. */
export const roundDecisionReleased = (round: SQL) =>
  sql`(${round}.status=${lifecycleSql(roundStatus.completed)})`;
