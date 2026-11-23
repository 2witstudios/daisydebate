import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQL } from 'bun';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { z } from 'zod';
import { runMigrations } from '../migrator';
import { postgresInt8, query, run } from '../raw-rows';
import {
  catalogDifferences,
  describeCatalogDifference,
  readSchemaCatalog,
} from '../schema-catalog';
import { MIGRATOR_SESSION } from '../session-bounds';
import { inTransaction, type Tx } from '../tx';
import {
  describeRefusal,
  journalMoved,
  planAdoption,
  supersededJournal,
  type JournalRow,
  type JournalStamp,
} from './adoption-plan';

/**
 * `adopt` swaps the journal; `check` proves the same and stops before the
 * swap, so the owner can run it against staging from a PR's image while
 * the old image can still ship a forward fix.
 */
export type AdoptionMode = 'adopt' | 'check';

export type AdoptionOutcome =
  | {
      /** `adoptable`: a check that would have adopted. */
      readonly kind: 'adopted' | 'adoptable';
      readonly baseline: string;
      readonly superseded: number;
      readonly later: readonly string[];
    }
  | { readonly kind: 'refused'; readonly reasons: readonly string[] };

const journalRow = z.object({
  id: z.number().int(),
  hash: z.string(),
  createdAt: postgresInt8.transform(Number),
  name: z.string().nullable(),
});

const readJournal = async (tx: Tx): Promise<readonly JournalRow[]> =>
  query(
    tx,
    journalRow,
    sql`select id, hash, created_at as "createdAt", name
        from drizzle.__drizzle_migrations order by id`,
  );

/** The image's folders, as the migrator reads them. */
const imageStamps = (migrationsFolder: string): readonly JournalStamp[] =>
  readMigrationFiles({ migrationsFolder }).map(
    ({ name, hash, folderMillis }) => ({
      name,
      hash,
      createdAt: folderMillis,
    }),
  );

/**
 * The innermost error's message: PostgreSQL's own reason under the
 * driver's wrapper. It names objects (a database, a statement), never row
 * data.
 */
const rootCause = (error: unknown): string => {
  let current = error;
  while (current instanceof Error && current.cause instanceof Error)
    current = current.cause;
  return current instanceof Error ? current.message : String(current);
};

const emptyDatabase = z.object({ objects: postgresInt8.transform(Number) });

/**
 * Builds the reference: the image's baseline and exactly the later folders
 * the live journal records, on an empty database of the same cluster.
 */
async function referenceCatalog({
  referenceUrl,
  migrationsFolder,
  folders,
}: {
  readonly referenceUrl: string;
  readonly migrationsFolder: string;
  readonly folders: readonly string[];
}) {
  const client = new SQL(referenceUrl, { max: 1 });
  try {
    const database = drizzle({ client });
    const [found] = await query(
      database,
      emptyDatabase,
      sql`select count(*) as objects from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname in ('public', 'drizzle')`,
    );
    if (found?.objects !== 0) return null;
    const scratch = await mkdtemp(join(tmpdir(), 'daisy-adoption-'));
    try {
      for (const folder of folders)
        await cp(join(migrationsFolder, folder), join(scratch, folder), {
          recursive: true,
        });
      await runMigrations({
        databaseUrl: referenceUrl,
        migrationsFolder: scratch,
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
    return await readSchemaCatalog(database);
  } finally {
    await client.close();
  }
}

/**
 * `bun db:adopt-baseline` (RECON-5.2, ADR 0913): adopts the baseline on a
 * database migrated the old way, keeping its data. It builds the reference
 * from the image, then in one transaction on the live database locks the
 * journal, requires it to be exactly the superseded history followed by
 * image folders, requires the live catalog to equal the reference's, and
 * swaps the superseded journal rows for the baseline's. Any difference
 * refuses with the list and changes nothing; no table row is written but
 * the journal's.
 */
export async function adoptBaseline({
  databaseUrl,
  referenceUrl,
  migrationsFolder,
  mode = 'adopt',
}: {
  readonly databaseUrl: string;
  readonly referenceUrl: string;
  readonly migrationsFolder: string;
  readonly mode?: AdoptionMode;
}): Promise<AdoptionOutcome> {
  const [baseline, ...imageLater] = imageStamps(migrationsFolder);
  if (baseline === undefined || !baseline.name.endsWith('_baseline'))
    return {
      kind: 'refused',
      reasons: ['The image does not start from a baseline folder'],
    };
  const plan = (journal: readonly JournalRow[]) =>
    planAdoption({
      journal,
      superseded: supersededJournal,
      baseline,
      imageLater,
    });
  const client = new SQL(databaseUrl, { max: 1, connection: MIGRATOR_SESSION });
  try {
    const live = drizzle({ client });
    const first = plan(await readJournal(live));
    if (!first.ok)
      return { kind: 'refused', reasons: [describeRefusal(first.refusal)] };
    const expected = await referenceCatalog({
      referenceUrl,
      migrationsFolder,
      folders: [baseline.name, ...first.plan.later.map(({ name }) => name)],
    }).catch((error: unknown) => ({ failed: rootCause(error) }));
    if (expected !== null && 'failed' in expected)
      return {
        kind: 'refused',
        reasons: [
          `The reference database could not be built (${expected.failed}); the live database is unchanged. Drop the reference and run again with a new, empty one`,
        ],
      };
    if (expected === null)
      return {
        kind: 'refused',
        reasons: [
          'The reference database is not empty; give the command a new, empty one',
        ],
      };
    return await inTransaction(live, async (tx): Promise<AdoptionOutcome> => {
      // Holds off a concurrent release run until the swap commits.
      await run(
        tx,
        sql`lock table drizzle.__drizzle_migrations in access exclusive mode`,
      );
      const locked = plan(await readJournal(tx));
      if (!locked.ok)
        return { kind: 'refused', reasons: [describeRefusal(locked.refusal)] };
      if (journalMoved(first.plan, locked.plan))
        return {
          kind: 'refused',
          reasons: [
            'The journal changed while the reference was built; run the command again',
          ],
        };
      const differences = catalogDifferences(
        expected,
        await readSchemaCatalog(tx),
      );
      if (differences.length > 0)
        return {
          kind: 'refused',
          reasons: differences.map(describeCatalogDifference),
        };
      const result = {
        baseline: baseline.name,
        superseded: locked.plan.deleteIds.length,
        later: locked.plan.later.map(({ name }) => name),
      };
      if (mode === 'check') return { kind: 'adoptable', ...result };
      await run(
        tx,
        // The superseded rows are exactly the journal's first ids.
        sql`delete from drizzle.__drizzle_migrations
            where id <= ${Math.max(...locked.plan.deleteIds)}`,
      );
      await run(
        tx,
        sql`insert into drizzle.__drizzle_migrations (id, hash, created_at, name)
            values (${locked.plan.baselineId}, ${baseline.hash}, ${baseline.createdAt}, ${baseline.name})`,
      );
      return { kind: 'adopted', ...result };
    });
  } finally {
    await client.close();
  }
}
