import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/migrator';
/** Own temporary forward folders, shared by migration lock and atomicity proofs. */
export async function migrationFolders(
  databaseUrl: string,
  migrationsTable: string,
) {
  const folder = await mkdtemp(join(tmpdir(), 'daisy-migration-proof-'));
  return {
    add: async (name: string, sql: string) => {
      await mkdir(join(folder, name));
      await writeFile(join(folder, name, 'migration.sql'), sql);
    },
    migrate: () =>
      runMigrations({
        databaseUrl,
        migrationsFolder: folder,
        migrationsTable,
        migrationsSchema: 'drizzle',
      }),
    close: () => rm(folder, { recursive: true, force: true }),
  };
}
