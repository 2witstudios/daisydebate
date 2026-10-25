import { SQL } from 'bun';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createId } from '@paralleldrive/cuid2';
import { runMigrations } from '../src/migrator';
import { createSlotDatabase, dropSlotDatabase } from '../src/slots';

const migrationsFolder = new URL('../migrations', import.meta.url).pathname;

/** CREATE DATABASE copies files; a loaded machine can exceed bun's 5 s default. */
export const ddlTimeoutMs = 60_000;

/**
 * A throwaway database for proving one migration against the rows the
 * schema before it allowed. Its name sits outside `daisy_wt_*`, so slot
 * pruning never selects it; the caller drops it.
 */
export const scratchDatabase = (url: string, prefix: string) => {
  const name = `${prefix}_${createId()}`;
  const target = new URL(url);
  target.pathname = `/${name}`;
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new SQL(adminUrl.toString(), { max: 1 });
  return {
    url: target.toString(),
    create: () => createSlotDatabase(admin, name),
    /** Applies the committed migration folders the predicate keeps, in order. */
    migrate: async (keep: (folder: string) => boolean) => {
      const folder = await mkdtemp(join(tmpdir(), `daisy-${prefix}-`));
      try {
        for (const entry of (await readdir(migrationsFolder)).sort())
          if (keep(entry))
            await cp(join(migrationsFolder, entry), join(folder, entry), {
              recursive: true,
            });
        await runMigrations({
          databaseUrl: target.toString(),
          migrationsFolder: folder,
        });
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    },
    drop: async () => {
      await dropSlotDatabase(admin, name);
      await admin.close();
    },
  };
};
