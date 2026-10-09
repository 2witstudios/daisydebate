import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/pg-core';
import { MIGRATOR_SESSION } from './session-bounds';

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
    for (let end = 1; end <= migrations.length; end += 1) {
      await migrate(migrations.slice(0, end), database, config);
    }
  } finally {
    await client.close();
  }
}
