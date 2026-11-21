import { sql, type SQL } from 'drizzle-orm';
import { reuseLicensingWordings } from '@daisy/protocol/media-release';

/**
 * Whether the Round with this id is a Youth Round (ADR 0157): Youth when
 * either its Room (casual included) or its frozen age rule is Youth, so it fails
 * closed. The SQL mirror of `isYouthRound` in `@daisy/protocol`. It never
 * fences who may view a Round (ADR 0161); it picks whose linked adults see
 * through private and the reuse fence below. The aliases are its own, so an
 * outer `rounds` or `rooms` stays the caller's.
 */
export const youthRoundSql = (roundId: SQL): SQL<boolean> =>
  sql<boolean>`exists (select 1 from rounds youth_r
    where youth_r.id = ${roundId}
      and (public.daisy_room_is_youth(youth_r.room_id) or youth_r.standing_age_rule='under-18'))`;

/**
 * The reuse fence (ADR 0161), the SQL mirror of `reuseFenced` in
 * `@daisy/protocol/media-release`: a Youth Round is fenced unless it has a
 * youth debater (a person in a current debating seat) and every one of them
 * holds an active release at a wording that licenses reuse. Download and
 * Stream this Round ask it; viewing never does. Missing age evidence in an
 * anyone lobby leaves reuse fenced even if the stored age was erased.
 */
export const youthReuseFencedSql = (roundId: SQL): SQL<boolean> =>
  sql<boolean>`(public.daisy_round_reuse_age_unknown(${roundId}) or (${youthRoundSql(roundId)} and (with debaters as (
      select debater_user_id from public.daisy_round_linked_adult_actors(${roundId})
    ) select not exists (select 1 from debaters)
      or exists (select 1 from debaters
        where not exists (select 1 from media_releases reuse_m
          where reuse_m.user_id = debaters.debater_user_id and reuse_m.scope = 'publish'
            and reuse_m.wording_version in (${sql.join(
              reuseLicensingWordings.map((version) => sql`${version}`),
              sql`, `,
            )})
            and reuse_m.withdrawn_at is null)))))`;
