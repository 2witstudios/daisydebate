import { SQL } from 'bun';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { runMigrations } from '../src/migrator';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('migration folders commit deferred references and roll back a failing next folder', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'room-migrations-'));
  const suffix = createId(),
    parent = `migration_parent_${suffix}`,
    child = `migration_child_${suffix}`,
    journal = `migration_journal_${suffix}`;
  const client = new SQL(databaseUrl);
  const add = async (name: string, sql: string) => {
    await mkdir(join(folder, name));
    await writeFile(join(folder, name, 'migration.sql'), sql);
  };
  const migrate = () =>
    runMigrations({
      databaseUrl,
      migrationsFolder: folder,
      migrationsTable: journal,
    });
  try {
    await add(
      '20990101000000_references',
      `CREATE TABLE "${parent}" (id integer PRIMARY KEY);\n--> statement-breakpoint\nCREATE TABLE "${child}" (parent_id integer REFERENCES "${parent}" DEFERRABLE INITIALLY DEFERRED);\n--> statement-breakpoint\nINSERT INTO "${parent}" VALUES (1);\n--> statement-breakpoint\nINSERT INTO "${child}" VALUES (1);`,
    );
    await add(
      '20990101000001_alter',
      `ALTER TABLE "${parent}" ADD COLUMN label text;`,
    );
    await migrate();
    await migrate();
    const [applied] = await client.unsafe(
      `SELECT count(*)::integer AS count FROM drizzle."${journal}"`,
    );
    assert({
      given: 'deferred reference inserts followed by an ALTER and a rerun',
      should: 'commit both folders exactly once',
      actual: applied.count,
      expected: 2,
    });
    await add(
      '20990101000002_fail',
      `ALTER TABLE "${parent}" ADD COLUMN refused integer;\n--> statement-breakpoint\nSELECT 1/0;`,
    );
    let failed = false;
    try {
      await migrate();
    } catch {
      failed = true;
    }
    const [state] = await client.unsafe(
      `SELECT (SELECT count(*)::integer FROM drizzle."${journal}") AS recorded, (SELECT count(*)::integer FROM information_schema.columns WHERE table_name=$1 AND column_name='refused') AS refused`,
      [parent],
    );
    assert({
      given: 'a later folder fails after DDL',
      should:
        'preserve earlier committed folders and roll back its DDL and journal entry',
      actual: [failed, state.recorded, state.refused],
      expected: [true, 2, 0],
    });
  } finally {
    await client.unsafe(
      `DROP TABLE IF EXISTS "${child}", "${parent}", drizzle."${journal}"`,
    );
    await client.close();
    await rm(folder, { recursive: true, force: true });
  }
});
