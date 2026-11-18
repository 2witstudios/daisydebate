import { sql, type SQL } from 'drizzle-orm';

/**
 * Media release standing in SQL (ADR 0151), spelled once beside the release
 * reads: `@daisy/protocol/media-release` holds the same rules for TypeScript.
 */

/** A request is waiting while it has no outcome and has not expired. */
export const releaseRequestWaiting = (now: SQL, request: SQL): SQL =>
  sql`(${request}.outcome is null and ${request}.expires_at > ${now})`;

/** A Youth Round's publication stands until a withdrawal ends it. */
export const youthRoundPublic = (publication: SQL): SQL =>
  sql`(${publication}.round_id is not null and ${publication}.ended_at is null)`;
