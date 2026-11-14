import { desc, eq } from 'drizzle-orm';
import { daisyOrganizationId } from './daisy-reference';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { seasons, type seasonStatuses } from './schema/ratings';

/**
 * A season as the season operations and the standings reads return it.
 * Package-internal: `@daisy/db/seasons` re-exports only the type.
 */
export type SeasonRecord = {
  readonly id: string;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly status: (typeof seasonStatuses)[number];
  readonly version: number;
};

export const toSeasonRecord = (
  row: typeof seasons.$inferSelect,
): SeasonRecord => ({
  id: row.id,
  name: row.name,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt?.toISOString() ?? null,
  status: row.status as SeasonRecord['status'],
  version: row.version,
});

/**
 * Every one of Daisy's rating seasons, newest start first: the one listing,
 * for the CLI and the ladder. A league's season is not a rating season.
 */
export const listSeasonRecords = async (
  database: BunSQLDatabase,
): Promise<readonly SeasonRecord[]> =>
  (
    await database
      .select()
      .from(seasons)
      .where(eq(seasons.organizationId, daisyOrganizationId))
      .orderBy(desc(seasons.startsAt))
  ).map(toSeasonRecord);
