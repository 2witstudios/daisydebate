import { SQL } from 'bun';
import { createAppError, type ErrorCode } from '@daisy/errors';
import { desc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { seasons } from './schema/ratings';
import { toSeasonRecord, type SeasonRecord } from './season-record';

/**
 * Season operations for the `bun season` CLI (ADR 0055): a season is opened
 * or closed from an operator's terminal, never from a route in `apps/web`
 * (ADR 0043). There is one season until DEC-111 decides how a debater carries
 * into the next: a rating refuses on a prior season's standing, so a second
 * season would stop rating every returning debater.
 */

export type { SeasonRecord } from './season-record';

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
  return toSeasonRecord(closed);
}

/** Serializes opening and beta activation, each of which reads for any season. */
const lockSeasonCreation = (tx: Tx) =>
  tx.execute(sql`select pg_advisory_xact_lock(59091, 1)`);

async function open(tx: Tx, input: NewSeason): Promise<SeasonRecord> {
  await lockSeasonCreation(tx);
  const [earlier] = await tx.select({ id: seasons.id }).from(seasons).limit(1);
  if (earlier)
    throw createAppError(
      'CONFLICT',
      'Another season requires DEC-111 resolution',
    );
  const [opened] = await tx
    .insert(seasons)
    .values({ ...input, status: 'active' })
    .returning();
  if (!opened)
    throw createAppError('INTERNAL', 'Season insert returned no row');
  return toSeasonRecord(opened);
}

const seasonOperations = (database: BunSQLDatabase) => ({
  /** Every season, newest start first. */
  async listSeasons(): Promise<readonly SeasonRecord[]> {
    const rows = await database
      .select()
      .from(seasons)
      .orderBy(desc(seasons.startsAt));
    return rows.map(toSeasonRecord);
  },

  /** Explicit activation only. Retries preserve the first actual activation. */
  activateBetaSeason(input: { readonly id: string }): Promise<SeasonRecord> {
    return database.transaction(async (tx) => {
      await lockSeasonCreation(tx);
      const [existing] = await tx
        .select()
        .from(seasons)
        .where(eq(seasons.activationKey, 'beta-season-1'));
      if (existing) return toSeasonRecord(existing);
      const [other] = await tx
        .select({ id: seasons.id })
        .from(seasons)
        .limit(1);
      if (other)
        throw createAppError(
          'CONFLICT',
          'Beta activation requires no competing season',
        );
      const [opened] = await tx
        .insert(seasons)
        .values({
          id: input.id,
          name: 'Season 1',
          activationKey: 'beta-season-1',
          startsAt: sql`clock_timestamp()`,
          status: 'active',
        })
        .returning();
      if (!opened)
        throw createAppError('INTERNAL', 'Season insert returned no row');
      return toSeasonRecord(opened);
    });
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
