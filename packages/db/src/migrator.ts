import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { takeLock, transactionLocks } from './locks';
import { query } from './raw-rows';
import { prepareTournamentLobbyBackfill } from './tournament-lobby-backfill';
import { MIGRATOR_SESSION } from './session-bounds';
import { inTransaction } from './tx';

/**
 * Applies the migration folder on one owner connection, bounded by
 * `MIGRATOR_SESSION` so hot-table DDL fails fast. The release command
 * (`scripts/migrate.ts`) passes the committed folder; the lock-bound proof
 * passes a scratch folder and journal so it never touches the real one.
 */
export async function runMigrations({
  databaseUrl,
  migrationsFolder,
  migrationsTable,
  migrationsSchema,
}: {
  readonly databaseUrl: string;
  readonly migrationsFolder: string;
  readonly migrationsTable?: string;
  readonly migrationsSchema?: string;
}): Promise<void> {
  const client = new SQL(databaseUrl, {
    max: 1,
    connection: MIGRATOR_SESSION,
  });
  try {
    const config = {
      migrationsFolder,
      ...(migrationsTable === undefined ? {} : { migrationsTable }),
      ...(migrationsSchema === undefined ? {} : { migrationsSchema }),
    };
    const database = drizzle({ client });
    const migrations = readMigrationFiles(config);
    // Commit each folder before the next DDL: reference inserts can leave
    // deferred FK events which PostgreSQL forbids a later ALTER to cross.
    for (const [index, current] of migrations.entries()) {
      const throughCurrent = migrations.slice(0, index + 1);
      if (!current.name.endsWith('_tournament_lobby_eligibility')) {
        await migrate(throughCurrent, database, config);
        continue;
      }
      const name = current.name;
      const schema = sql.identifier(migrationsSchema ?? 'drizzle');
      const table = sql.identifier(migrationsTable ?? '__drizzle_migrations');
      await inTransaction(database, async (tx) => {
        await takeLock(tx, transactionLocks.migrationBackfill(name));
        const applied = await query(
          tx,
          z.object({ applied: z.boolean() }),
          sql`select true as applied from ${schema}.${table} where name = ${name}`,
        );
        if (applied.length === 0) await prepareTournamentLobbyBackfill(tx);
        await migrate(throughCurrent, tx, config);
      });
    }
    // Startup reads version provenance, never migration contents or writes.
    // Keep this release permission beside the runner-owned journal, including
    // on existing databases with no pending folders. Test journals stay private.
    if (migrationsTable === undefined && migrationsSchema === undefined) {
      await client`grant usage on schema drizzle to daisy_web`;
      await client`grant select (hash, created_at, id) on drizzle.__drizzle_migrations to daisy_web`;
    }
  } finally {
    await client.close();
  }
}
