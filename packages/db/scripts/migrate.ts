import { fileURLToPath } from 'node:url';
import { readMigrationConfig } from '@daisy/config';
import { SQL } from 'bun';
import { runMigrations } from '../src/migrator';

// Production migrates only as the owner in MIGRATION_DATABASE_URL, never
// the runtime DATABASE_URL (ISSUE-39); errors name fields, never values.
// The session is lock-bounded (ISSUE-112): see src/session-bounds.ts.
const { databaseUrl } = readMigrationConfig(process.env);
await runMigrations({
  databaseUrl,
  migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
});

// A CHECK added NOT VALID stays so when a stored row breaks it (the driver
// drops the migration's warning). Say which, so the row gets repaired.
const sql = new SQL(databaseUrl, { max: 1 });
try {
  const pending =
    (await sql`select conrelid::regclass::text as relation, conname
    from pg_constraint where not convalidated order by 1, 2`) as {
      relation: string;
      conname: string;
    }[];
  for (const { relation, conname } of pending)
    process.stdout.write(
      `migrate: constraint ${conname} on ${relation} is NOT VALID: stored rows break it (docs/operations/database.md)\n`,
    );
} finally {
  await sql.close();
}
