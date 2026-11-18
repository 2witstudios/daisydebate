import { ageBands, divisionOfAgeBand, type AgeBand } from '@daisy/protocol';
import { sql, type SQL } from 'drizzle-orm';
import { daisyOrganizationId } from './daisy-reference';
import { accountAge } from './schema/account-age';

/**
 * The age band a member's ladder division is read from (ADR 0147): ADR 0075's
 * one band rule, aged on the start of Daisy's active Youth season, so a
 * member who turns 18 mid-season finishes that season on Youth and Open
 * starts with the next. The record must be valid now; only the age is taken
 * on the season's start. With no Youth season active, the age is taken now.
 * The birth month stays in SQL; only the band leaves it. Over the
 * `account_age` row joined into the caller's query.
 */
export const divisionAgeBand = (): SQL<AgeBand | null> => {
  const agedAt = sql`least(clock_timestamp(), coalesce((select youth.starts_at from seasons youth where youth.status = 'active' and youth.division = 'youth' and youth.organization_id = ${daisyOrganizationId}), clock_timestamp()))`;
  return sql<AgeBand | null>`case when public.daisy_age_band(${accountAge.birthMonth}, ${accountAge.version}, ${accountAge.recordedAt}, clock_timestamp()) is null then null else public.daisy_age_band(${accountAge.birthMonth}, ${accountAge.version}, least(${accountAge.recordedAt}, ${agedAt}), ${agedAt}) end`;
};

/**
 * `divisionOfAgeBand` spelled in SQL over a band expression, generated from
 * the protocol rule and its band vocabulary so the two can never differ. No
 * band (no valid record) is no division.
 */
export const divisionOfBandSql = (band: SQL): SQL =>
  sql`(case ${band} ${sql.join(
    ageBands.map((each) =>
      sql.raw(`when '${each}' then '${divisionOfAgeBand(each)}'`),
    ),
    sql` `,
  )} end)`;

/**
 * The ladder divisions of a Room's seated human debaters, as a JSON array
 * (`roomId` names the Room, `r.id` by default): the facts
 * `divisionForSeatedDebaters` reads.
 */
export const seatedDebaterDivisionsSql = (roomId: SQL = sql`r.id`): SQL =>
  sql`(select coalesce(json_agg(${divisionOfBandSql(divisionAgeBand())}), '[]'::json)
    from room_participants seated join actors seated_actor on seated_actor.id = seated.actor_id
    left join account_age on account_age.user_id = seated_actor.user_id
    where seated.room_id = ${roomId} and seated_actor.kind = 'human' and seated.seat_kind in ('side', 'speaker'))`;
