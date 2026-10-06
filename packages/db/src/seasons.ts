import { SQL } from 'bun';
import { createAppError, type ErrorCode } from '@daisy/errors';
import { desc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { seasons, type seasonStatuses } from './schema/ratings';
import { isUniqueViolation } from './unique-violation';

/**
 * Season operations for the `bun season` CLI (ADR 0055): a season is opened,
 * closed or rolled over from an operator's terminal, never from a route in
 * `apps/web` (ADR 0043). At most one season is active; the partial unique
 * index `seasons_single_active` is the arbiter.
 */

export type SeasonRecord = {
  readonly id: string;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly status: (typeof seasonStatuses)[number];
  readonly version: number;
};

type NewSeason = {
  readonly id: string;
  readonly name: string;
  readonly startsAt: Date;
};

type Tx = Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0];

/**
 * Why a season cannot be closed at `endsAt`, or null when it can. Pure: the
 * operation reads the row and asks this before it writes anything.
 */
export function closeRefusal(
  season: {
    readonly status: SeasonRecord['status'];
    readonly startsAt: Date;
  } | null,
  endsAt: Date,
): Extract<ErrorCode, 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION'> | null {
  if (season === null) return 'NOT_FOUND';
  if (season.status !== 'active') return 'CONFLICT';
  if (endsAt.getTime() <= season.startsAt.getTime()) return 'VALIDATION';
  return null;
}

const refusalMessages = {
  NOT_FOUND: 'No such season',
  CONFLICT: 'Only the active season can be closed',
  VALIDATION: 'A season must end after it starts',
} as const;

const toRecord = (row: typeof seasons.$inferSelect): SeasonRecord => ({
  id: row.id,
  name: row.name,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt?.toISOString() ?? null,
  status: row.status as SeasonRecord['status'],
  version: row.version,
});

async function close(
  tx: Tx,
  input: { readonly id: string; readonly endsAt: Date },
): Promise<SeasonRecord> {
  const [current] = await tx
    .select()
    .from(seasons)
    .where(eq(seasons.id, input.id))
    .for('update');
  const refusal = closeRefusal(
    current
      ? {
          status: current.status as SeasonRecord['status'],
          startsAt: current.startsAt,
        }
      : null,
    input.endsAt,
  );
  if (refusal) throw createAppError(refusal, refusalMessages[refusal]);
  const [closed] = await tx
    .update(seasons)
    .set({
      status: 'closed',
      endsAt: input.endsAt,
      updatedAt: sql`now()`,
      version: sql`${seasons.version} + 1`,
    })
    .where(eq(seasons.id, input.id))
    .returning();
  if (!closed) throw createAppError('CONFLICT', 'The season changed');
  return toRecord(closed);
}

async function open(tx: Tx, input: NewSeason): Promise<SeasonRecord> {
  try {
    const [opened] = await tx
      .insert(seasons)
      .values({ ...input, status: 'active' })
      .returning();
    if (!opened)
      throw createAppError('INTERNAL', 'Season insert returned no row');
    return toRecord(opened);
  } catch (error) {
    if (isUniqueViolation(error))
      throw createAppError('CONFLICT', 'A season is already active', error);
    throw error;
  }
}

const seasonOperations = (database: BunSQLDatabase) => ({
  /** Every season, newest start first. */
  async listSeasons(): Promise<readonly SeasonRecord[]> {
    const rows = await database
      .select()
      .from(seasons)
      .orderBy(desc(seasons.startsAt));
    return rows.map(toRecord);
  },

  openSeason(input: NewSeason): Promise<SeasonRecord> {
    return database.transaction((tx) => open(tx, input));
  },

  closeSeason(input: {
    readonly id: string;
    readonly endsAt: Date;
  }): Promise<SeasonRecord> {
    return database.transaction((tx) => close(tx, input));
  },

  /** Closes the active season at the next one's start and opens it, atomically. */
  rolloverSeason(input: {
    readonly closeId: string;
    readonly open: NewSeason;
  }): Promise<{ closed: SeasonRecord; opened: SeasonRecord }> {
    return database.transaction(async (tx) => {
      const closed = await close(tx, {
        id: input.closeId,
        endsAt: input.open.startsAt,
      });
      return { closed, opened: await open(tx, input.open) };
    });
  },
});

export type SeasonOperations = ReturnType<typeof seasonOperations>;

/**
 * Runs `work` over one connection to `url`, then closes it. `client`
 * overrides dialing `url`; unit tests inject a scripted client here.
 */
export async function withSeasons<T>(
  url: string,
  work: (operations: SeasonOperations) => Promise<T>,
  client: SQL = new SQL(url, { max: 1 }),
): Promise<T> {
  try {
    return await work(seasonOperations(drizzle({ client })));
  } finally {
    await client.close();
  }
}
