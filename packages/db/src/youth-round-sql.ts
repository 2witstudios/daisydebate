import { sql, type SQL } from 'drizzle-orm';
import { isDebatingSeatSql } from './seat-columns';

/**
 * Whether the Round with this id is a Youth Round (ADR 0157): Youth when
 * either its Room (casual included) or its frozen ladder is Youth, so it fails
 * closed. The SQL mirror of `isYouthRound` in `@daisy/protocol`. It never
 * fences who may view a Round (ADR 0159); it picks whose linked adults see
 * through private and the reuse fence below. The aliases are its own, so an
 * outer `rounds` or `rooms` stays the caller's.
 */
export const youthRoundSql = (roundId: SQL): SQL<boolean> =>
  sql<boolean>`exists (select 1 from rounds youth_r
    left join rooms youth_room on youth_room.id = youth_r.room_id
    where youth_r.id = ${roundId}
      and (youth_room.division = 'youth' or youth_r.ladder_division = 'youth'))`;

/**
 * The reuse fence (ADR 0159), the SQL mirror of `reuseFenced` in
 * `@daisy/protocol/media-release`: a Youth Round is fenced unless it has a
 * youth debater (a person in a current debating seat) and every one of them
 * holds an active release. Any other Round is never fenced. Download and
 * Stream this Round ask it; viewing never does.
 */
export const youthReuseFencedSql = (roundId: SQL): SQL<boolean> =>
  sql<boolean>`(${youthRoundSql(roundId)} and not (
    exists (select 1 from round_participants reuse_p
      join actors reuse_a on reuse_a.id = reuse_p.actor_id
      where reuse_p.round_id = ${roundId} and ${isDebatingSeatSql(sql`reuse_p.seat_kind`)}
        and public.daisy_round_participant_is_current(reuse_p.id) and reuse_a.user_id is not null)
    and not exists (select 1 from round_participants reuse_p
      join actors reuse_a on reuse_a.id = reuse_p.actor_id
      where reuse_p.round_id = ${roundId} and ${isDebatingSeatSql(sql`reuse_p.seat_kind`)}
        and public.daisy_round_participant_is_current(reuse_p.id) and reuse_a.user_id is not null
        and not exists (select 1 from media_releases reuse_m
          where reuse_m.user_id = reuse_a.user_id and reuse_m.scope = 'publish'
            and reuse_m.withdrawn_at is null))))`;
