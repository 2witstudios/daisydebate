import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { fileURLToPath } from 'node:url';
import { readMigrationConfig } from '@daisy/config';

// Production migrates only as the owner in MIGRATION_DATABASE_URL, never
// the runtime DATABASE_URL (ISSUE-39); errors name fields, never values.
const { databaseUrl } = readMigrationConfig(process.env);
const client = new SQL(databaseUrl, { max: 1 });
try {
  await migrate(drizzle({ client }), {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  });
} finally {
  await client.close();
}
