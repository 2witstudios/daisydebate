import { sql, type SQL } from 'drizzle-orm';

/**
 * Challenges' published read: the one rule for a challenge still open to an
 * answer at `at`. Nobody has accepted it into a Room, and `at` is before its
 * expiry. `challenge` names the `challenges` row in the reader's query.
 */
export const challengeOpen = (at: SQL, challenge: SQL) =>
  sql`(${challenge}.room_id is null and ${challenge}.expires_at > ${at})`;

/**
 * Challenges' published read for an answered challenge: it was accepted into
 * a Room and its challenger is still sent there at `at`.
 */
export const challengeAccepted = (at: SQL, challenge: SQL) =>
  sql`(${challenge}.room_id is not null and ${challenge}.follow_until > ${at})`;
