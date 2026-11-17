import { sql, type SQL } from 'drizzle-orm';

/**
 * Friends' published reads (ADR 0143). `friendship` names the `friendships`
 * row in the reader's query; a declined, removed or blocked pair has no row.
 */

/** The friend request is still asked: nobody has answered it. */
export const friendRequestOpen = (friendship: SQL) =>
  sql`(${friendship}.state='pending')`;

/** The pair are friends. */
export const friendshipAccepted = (friendship: SQL) =>
  sql`(${friendship}.state='accepted')`;
