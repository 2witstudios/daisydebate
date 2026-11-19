import { sql, type SQL } from 'drizzle-orm';

/**
 * Whether the Round with this id is a Youth Round (ADR 0150, amended by ADR
 * 0157): Youth when either its Room (casual included) or its frozen ladder is
 * Youth, so it fails closed. The SQL mirror of `isYouthRound` in
 * `@daisy/protocol`; every SQL fence of ADR 0150 and 0151 asks this, never
 * `ladder_division` alone. The aliases are its own, so an outer `rounds` or
 * `rooms` stays the caller's.
 */
export const youthRoundSql = (roundId: SQL): SQL<boolean> =>
  sql<boolean>`exists (select 1 from rounds youth_r
    left join rooms youth_room on youth_room.id = youth_r.room_id
    where youth_r.id = ${roundId}
      and (youth_room.division = 'youth' or youth_r.ladder_division = 'youth'))`;
