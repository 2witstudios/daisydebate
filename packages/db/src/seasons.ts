import { SQL } from 'bun';
import { readOfficialStandingLobbies } from './official-standing-lobbies';
import { createAppError } from '@daisy/errors';
import { ratingDivisionForAgeRule, type RatingDivision } from '@daisy/protocol';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { seasons } from './schema/seasons';
import {
  listSeasonRecords,
  toSeasonRecord,
  type SeasonRecord,
} from './season-record';

/**
 * Season operations for the `bun season` CLI (ADR 0055): a season is opened
 * from an operator's terminal, never from a route in `apps/web` (ADR 0043).
 * Operator-managed seasons keep the DEC-111 rollover guard. The command
 * resolves an official standing lobby before it reads or writes seasons.
 */

export type { SeasonRecord } from './season-record';

type SeasonLobby =
  | { readonly lobbyId: string; readonly division?: never }
  | { readonly division: RatingDivision; readonly lobbyId?: never };
type NewSeason = SeasonLobby & {
  readonly id: string;
  readonly name: string;
  readonly startsAt: Date;
};

type Tx = Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0];

/** Resolve the existing operator CLI's flag through the official lobby catalog. */
const seasonLobby = async (tx: Tx, selection: SeasonLobby) => {
  const lobby = (await readOfficialStandingLobbies(tx)).find((lobby) =>
    selection.lobbyId !== undefined
      ? lobby.id === selection.lobbyId
      : ratingDivisionForAgeRule(lobby.ageRule) === selection.division,
  );
  if (!lobby)
    throw createAppError(
      'CONFLICT',
      'Season activation requires an official standing lobby',
    );
  return lobby;
};

/** Serializes opening and beta activation, each of which reads for any season. */
const lockSeasonCreation = (tx: Tx) =>
  tx.execute(sql`select pg_advisory_xact_lock(59091, 1)`);

async function open(tx: Tx, input: NewSeason): Promise<SeasonRecord> {
  await lockSeasonCreation(tx);
  const lobby = await seasonLobby(tx, input);
  const [earlier] = await tx
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.lobbyId, lobby.id))
    .limit(1);
  if (earlier)
    throw createAppError(
      'CONFLICT',
      'Another season requires DEC-111 resolution',
    );
  const [opened] = await tx
    .insert(seasons)
    .values({
      id: input.id,
      name: input.name,
      startsAt: input.startsAt,
      lobbyId: lobby.id,
      organizationId: lobby.organizationId,
      status: 'active',
    })
    .returning();
  if (!opened)
    throw createAppError('INTERNAL', 'Season insert returned no row');
  return toSeasonRecord(opened);
}

const seasonOperations = (database: BunSQLDatabase) => ({
  /** Every season, newest start first. */
  listSeasons: () => listSeasonRecords(database),

  /**
   * Explicit activation of one lobby's Season 1 only. Retries preserve the
   * first actual activation.
   */
  activateBetaSeason(
    input: SeasonLobby & {
      readonly id: string;
    },
  ): Promise<SeasonRecord> {
    return database.transaction(async (tx) => {
      await lockSeasonCreation(tx);
      const lobby = await seasonLobby(tx, input);
      const [existing] = await tx
        .select()
        .from(seasons)
        .where(
          and(
            eq(seasons.activationKey, 'beta-season-1'),
            eq(seasons.lobbyId, lobby.id),
          ),
        );
      if (existing) return toSeasonRecord(existing);
      const [other] = await tx
        .select({ id: seasons.id })
        .from(seasons)
        .where(eq(seasons.lobbyId, lobby.id))
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
          organizationId: lobby.organizationId,
          lobbyId: lobby.id,
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

  /** With no next season to open, closing the only one would strand rating. */
  closeSeason(): Promise<never> {
    return Promise.reject(
      createAppError(
        'CONFLICT',
        'Closing a season requires DEC-111 resolution',
      ),
    );
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
