import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/pg-core';
import { MIGRATOR_SESSION } from '../../src/session-bounds';
import { inTransaction } from '../../src/tx';
import { prepareTournamentLobbyBackfill } from './superseded-tournament-backfill';

const repository = resolve(import.meta.dir, '../../../..');
const migrationsPath = 'packages/db/migrations';

/**
 * The migration folders the baseline replaced, written out from git as
 * they were committed at `commit`: every folder up to and including
 * `cutoff`. Building a database from them is building it the old way.
 * Development and tests only; the image ships no superseded folder.
 */
export async function supersededFolders({
  commit,
  cutoff,
}: {
  readonly commit: string;
  readonly cutoff: string;
}): Promise<{ readonly folder: string; readonly close: () => Promise<void> }> {
  const scratch = await mkdtemp(join(tmpdir(), 'daisy-superseded-'));
  // A shallow checkout lacks the cut-off commit; fetch that one commit.
  const present =
    await Bun.$`git -C ${repository} cat-file -e ${`${commit}^{tree}`}`
      .quiet()
      .nothrow();
  if (present.exitCode !== 0)
    await Bun.$`git -C ${repository} fetch --quiet --depth=1 origin ${commit}`.quiet();
  await Bun.$`git -C ${repository} archive --format=tar ${commit} -- ${migrationsPath} | tar -x -C ${scratch}`.quiet();
  const folder = join(scratch, migrationsPath);
  const entries = await readdir(folder);
  if (!entries.includes(cutoff))
    throw new Error(`${commit} holds no migration folder ${cutoff}`);
  for (const entry of entries)
    if (entry > cutoff)
      await rm(join(folder, entry), { recursive: true, force: true });
  return {
    folder,
    close: () => rm(scratch, { recursive: true, force: true }),
  };
}

/**
 * Applies the superseded folders as the old migrator did, including its
 * preparation step for `_tournament_lobby_eligibility`, one transaction
 * per folder. With `superseded.folder` this builds a database the old way.
 */
export async function migrateOldWay({
  databaseUrl,
  folder,
}: {
  readonly databaseUrl: string;
  readonly folder: string;
}): Promise<void> {
  const client = new SQL(databaseUrl, { max: 1, connection: MIGRATOR_SESSION });
  try {
    const database = drizzle({ client });
    const migrations = readMigrationFiles({ migrationsFolder: folder });
    for (const [index, current] of migrations.entries()) {
      const through = migrations.slice(0, index + 1);
      if (current.name.endsWith('_tournament_lobby_eligibility'))
        await inTransaction(database, async (tx) => {
          await prepareTournamentLobbyBackfill(tx);
          await migrate(through, tx, { migrationsFolder: folder });
        });
      else await migrate(through, database, { migrationsFolder: folder });
    }
    await client`grant usage on schema drizzle to daisy_web`;
    await client`grant select (hash, created_at, id) on drizzle.__drizzle_migrations to daisy_web`;
  } finally {
    await client.close();
  }
}
