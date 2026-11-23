import { sql, type SQL } from 'drizzle-orm';

/**
 * Whether this Broadcast's video is withheld: only an operator's stop
 * (`stopBroadcast`, WATCH-7) sets `media_withheld`. Every read that asks
 * "is the video withheld" asks this. `broadcast` is the Broadcast row's alias
 * or table in the caller's query.
 */
export const operatorWithheldSql = (broadcast: SQL): SQL =>
  sql`coalesce(${broadcast}.media_withheld, false)`;
