import { sql, type SQL } from 'drizzle-orm';

/**
 * Whether this Broadcast's video is withheld by an operator's stop. The youth
 * sweep also sets `media_withheld` when it stops a Youth Round's Broadcast
 * (ADR 0150 §4), but that stop only hides a feed from an audience the Round
 * never had (`stop_reason = 'youth_round_private'`): the Round's own people,
 * and its share once published, still see the video (ADR 0157). Every read
 * that asks "is the video withheld" asks this, never `media_withheld` alone.
 * `broadcast` is the Broadcast row's alias or table in the caller's query.
 */
export const operatorWithheldSql = (broadcast: SQL): SQL<boolean> =>
  sql<boolean>`coalesce(${broadcast}.media_withheld and ${broadcast}.stop_reason is distinct from 'youth_round_private', false)`;
