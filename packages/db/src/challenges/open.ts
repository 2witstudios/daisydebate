import { sql, type SQL } from 'drizzle-orm';

/**
 * Challenges' published read: the one rule for a challenge still open to an
 * answer at `at`. Nobody has accepted it into a Room, and `at` is before its
 * expiry. `challenge` names the `challenges` row in the reader's query.
 */
export const challengeOpen = (at: SQL, challenge: SQL) =>
  sql`(${challenge}.room_id is null and ${challenge}.expires_at > ${at})`;
