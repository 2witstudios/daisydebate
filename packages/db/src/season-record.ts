import { desc, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { seasons, type seasonStatuses } from './schema/seasons';

/** A season as the standings reads return it. */
export type SeasonRecord = {
  readonly id: string;
  readonly name: string;
  readonly lobbyId: string;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly status: (typeof seasonStatuses)[number];
  readonly version: number;
};

const toSeasonRecord = (row: typeof seasons.$inferSelect): SeasonRecord => ({
  id: row.id,
  name: row.name,
  lobbyId: row.lobbyId,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt?.toISOString() ?? null,
  status: row.status as SeasonRecord['status'],
  version: row.version,
});

/** Seasons for the requested lobby, newest first. The operator may list all. */
export const listSeasonRecords = async (
  database: Pick<BunSQLDatabase, 'select'>,
  lobbyId?: string,
): Promise<readonly SeasonRecord[]> =>
  (
    await database
      .select()
      .from(seasons)
      .where(lobbyId === undefined ? undefined : eq(seasons.lobbyId, lobbyId))
      .orderBy(desc(seasons.startsAt))
  ).map(toSeasonRecord);
