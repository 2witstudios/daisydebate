import { fileURLToPath } from 'node:url';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { readAdminMigrationUrl } from '../config';

/**
 * `fly.admin-migrate.toml`'s release command: migrates the admin database
 * as its owner, ADMIN_MIGRATION_DATABASE_URL, which only that release-only
 * app holds (ADR 0041, ADR 0077). Errors name fields, never values.
 */
export async function migrateAdminDatabase(url: string): Promise<void> {
  const client = new SQL(url, {
    max: 1,
    // Fail fast instead of queueing DDL behind a long-held lock.
    connection: { lock_timeout: '5s', statement_timeout: '60s' },
  });
  try {
    await migrate(drizzle({ client }), {
      migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)),
    });
  } finally {
    await client.close();
  }
}

if (import.meta.main)
  await migrateAdminDatabase(readAdminMigrationUrl(process.env));
