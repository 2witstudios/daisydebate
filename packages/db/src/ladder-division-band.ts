import {
  YOUTH_CARRY_MONTHS,
  ageBands,
  divisionOfAgeBand,
  type AgeBand,
} from '@daisy/protocol';
import { sql, type SQL } from 'drizzle-orm';
import { daisyOrganizationId } from './daisy-reference';
import { accountAge } from './schema/account-age';
import { eq } from 'drizzle-orm';
import type { Tx } from './tx';

/**
 * The age band a member's ladder division is read from (ADR 0147 §3): ADR
 * 0075's one band rule, the record valid now, the age taken on the latest of
 * three instants, never after now:
 * - the start of Daisy's active Youth season, so a member who turns 18
 *   mid-season finishes that season on Youth and Open starts with the next;
 * - the member's own age record, so nobody is aged before they told us,
 *   and a member who signs up at 18 is on Open from the start;
 * - `YOUTH_CARRY_MONTHS` ago, so a Youth season that never closes holds
 *   nobody on Youth for longer than that past their birthday.
 * With no Youth season active, the age is taken now. The birth month stays
 * in SQL; only the band leaves it. Over the `account_age` row joined into the
 * caller's query.
 */
export const divisionAgeBand = (): SQL<AgeBand | null> => {
  const youthStart = sql`(select youth.starts_at from seasons youth where youth.status = 'active' and youth.division = 'youth' and youth.organization_id = ${daisyOrganizationId})`;
  const agedAt = sql`least(clock_timestamp(), greatest(coalesce(${youthStart}, clock_timestamp()), ${accountAge.recordedAt}, clock_timestamp() - make_interval(months => ${YOUTH_CARRY_MONTHS}::int)))`;
  return sql<AgeBand | null>`case when public.daisy_age_band(${accountAge.birthMonth}, ${accountAge.version}, ${accountAge.recordedAt}, clock_timestamp()) is null then null else public.daisy_age_band(${accountAge.birthMonth}, ${accountAge.version}, ${accountAge.recordedAt}, ${agedAt}) end`;
};

/** The age band used by competition during the staged ladder migration. */
export const readCompetitionAgeBand = async (
  tx: Pick<Tx, 'select'>,
  userId: string,
): Promise<AgeBand | null> => {
  const [age] = await tx
    .select({ band: divisionAgeBand() })
    .from(accountAge)
    .where(eq(accountAge.userId, userId));
  return age?.band ?? null;
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
