import { sql, type SQL } from 'drizzle-orm';

/**
 * Whether this Broadcast's video is withheld: only an operator's stop
 * (`stopBroadcast`, WATCH-7) sets `media_withheld`. The youth sweep stops a
 * Youth Round's Broadcast without it (ADR 0150 §4 as amended by ADR 0157), so
 * no stop reason has to be read to tell the two apart. Every read that asks
 * "is the video withheld" asks this. `broadcast` is the Broadcast row's alias
 * or table in the caller's query.
 */
export const operatorWithheldSql = (broadcast: SQL): SQL<boolean> =>
  sql<boolean>`coalesce(${broadcast}.media_withheld, false)`;
