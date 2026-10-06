import type { seasons, seasonStatuses } from './schema/ratings';

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
