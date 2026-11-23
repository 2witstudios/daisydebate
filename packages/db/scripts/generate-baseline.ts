import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { authoredCheck, baselineSql } from '../src/baseline/baseline-sql';
import { readBaselineRecord } from '../src/baseline/baseline-record';
import {
  migrateOldWay,
  supersededFolders,
} from '../src/baseline/superseded-history';
import {
  catalogDifferences,
  describeCatalogDifference,
  readSchemaCatalog,
  type SchemaCatalog,
} from '../src/schema-catalog';
import { scratchDatabase } from '../src/testing-scratch';

/**
 * `bun packages/db/scripts/generate-baseline.ts` (RECON-5.1, ADR 0913):
 * writes the baseline folder and the superseded journal from a database
 * migrated the old way through the recorded cut-off. The schema's
 * functions, triggers, policies and grants exist only in migration SQL, so
 * the baseline is read back from that database's catalog with `pg_dump`
 * (run inside the shared Compose stack's Postgres, whose version is the
 * server's), never generated from the Drizzle schema. It refuses to write a
 * baseline whose own catalog differs from the old history's;
 * `baseline-catalog.integration.ts` proves the committed result.
 */

const repository = resolve(import.meta.dir, '../../..');
const record = await readBaselineRecord();
// A local checkout's own database names the cluster; the work happens in
// scratch databases beside it, dropped afterwards.
const databaseUrl = process.env.DATABASE_URL ?? '';
if (!['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname))
  throw new Error('Generate the baseline against the local Compose stack only');

const catalogOf = async (url: string) => {
  const client = new SQL(url, { max: 1 });
  try {
    return await readSchemaCatalog(drizzle({ client }));
  } finally {
    await client.close();
  }
};

/** The facts `baselineSql` needs that only the source database knows. */
const sourceFacts = async (url: string) => {
  const client = new SQL(url, { max: 1 });
  try {
    const [{ owner } = { owner: '' }] = (await client`
      select current_user as owner`) as { owner: string }[];
    const named = (await client`
      select r.rolname as name,
        r.rolcanlogin and not r.rolsuper and not r.rolcreatedb
        and not r.rolcreaterole and not r.rolreplication and not r.rolbypassrls
        and r.rolinherit and r.rolconnlimit = -1 and r.rolconfig is null
        and not exists (select 1 from pg_auth_members m where m.member = r.oid) as plain
      from pg_roles r
      where r.rolname <> current_user and r.rolname !~ '^pg_' and r.rolname in (
        select (aclexplode(a)).grantee::regrole::text from (
          select nspacl a from pg_namespace union all select relacl from pg_class
          union all select attacl from pg_attribute union all select proacl from pg_proc
          union all select defaclacl from pg_default_acl) acls where a is not null)
      order by 1`) as { name: string; plain: boolean }[];
    const odd = named.filter(({ plain }) => !plain).map(({ name }) => name);
    if (odd.length > 0)
      throw new Error(
        `The baseline creates only plain login roles; ${odd.join(', ')} is not one`,
      );
    const stamped = (await client`
      select n.nspname || '.' || c.relname as "table",
        array_agg(a.attname::text order by a.attnum) as columns
      from pg_attribute a join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where a.atttypid = 'xid8'::regtype and n.nspname = 'public' and c.relkind = 'r'
      group by 1`) as { table: string; columns: string[] }[];
    return {
      owner,
      roles: named.map(({ name }) => ({ name })),
      transactionIdColumns: new Map(
        stamped.map(({ table, columns }) => [table, columns]),
      ),
    };
  } finally {
    await client.close();
  }
};

/** The catalog differences of a database built from `sql` alone. */
const differencesOf = async (sql: string, expected: SchemaCatalog) => {
  const folder = await mkdtemp(join(tmpdir(), 'daisy-baseline-check-'));
  const built = scratchDatabase(databaseUrl, 'baselinecheck');
  try {
    await mkdir(join(folder, record.tag));
    await writeFile(join(folder, record.tag, 'migration.sql'), sql);
    await built.create();
    await built.migrateFolder(folder);
    return catalogDifferences(expected, await catalogOf(built.url));
  } finally {
    await built.drop();
    await rm(folder, { recursive: true, force: true });
  }
};

const superseded = await supersededFolders(record);
const oldWay = scratchDatabase(databaseUrl, 'baselinegen');
try {
  await oldWay.create();
  await migrateOldWay({ databaseUrl: oldWay.url, folder: superseded.folder });
  const source = new URL(oldWay.url);
  const dump =
    await Bun.$`docker compose -f ${join(repository, 'infra/compose.yaml')} exec -T postgres pg_dump --username=${decodeURIComponent(source.username)} --dbname=${source.pathname.slice(1)} --no-owner --column-inserts --exclude-schema=drizzle`.text();
  const facts = await sourceFacts(oldWay.url);
  const expected = await catalogOf(oldWay.url);
  const header = `-- The schema baseline (ADR 0913): the catalog of a database migrated
-- through ${record.cutoff} at ${record.commit.slice(0, 12)}, read back
-- with pg_dump by packages/db/scripts/generate-baseline.ts. Do not edit by
-- hand; baseline-catalog.integration.ts proves it equals the old history.`;
  const history = await Promise.all(
    (await readdir(superseded.folder))
      .sort()
      .map((tag) =>
        readFile(join(superseded.folder, tag, 'migration.sql'), 'utf8'),
      ),
  );
  const draft = baselineSql({
    dump,
    header,
    ...facts,
    authoredChecks: new Map(),
  });
  // A CHECK whose dumped text parses to another tree takes its authored text.
  const reparsed = (await differencesOf(draft, expected)).flatMap(
    (difference) => {
      const match = /^constraint [a-z0-9_]+\.[a-z0-9_]+\.([a-z0-9_]+)$/.exec(
        difference.key,
      );
      return difference.kind === 'changed' && match?.[1] ? [match[1]] : [];
    },
  );
  const sql = baselineSql({
    dump,
    header,
    ...facts,
    authoredChecks: new Map(
      reparsed.map((name) => [name, authoredCheck(history, name)]),
    ),
  });
  const remaining = await differencesOf(sql, expected);
  if (remaining.length > 0)
    throw new Error(
      `The baseline's catalog differs from the old history's:\n${remaining.map(describeCatalogDifference).join('\n')}`,
    );
  const folder = join(repository, 'packages/db/migrations', record.tag);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'migration.sql'), sql);
  const snapshot = JSON.parse(
    await readFile(
      join(superseded.folder, record.cutoff, 'snapshot.json'),
      'utf8',
    ),
  ) as { prevIds: string[] };
  // The cut-off's snapshot, as the origin of the chain: later folders name
  // its id as their predecessor, so they keep applying on top.
  await writeFile(
    join(folder, 'snapshot.json'),
    `${JSON.stringify({ ...snapshot, prevIds: ['00000000-0000-0000-0000-000000000000'] }, null, 2)}\n`,
  );
  await writeFile(
    join(repository, 'packages/db/src/baseline/superseded-journal.json'),
    `${JSON.stringify(
      readMigrationFiles({ migrationsFolder: superseded.folder }).map(
        ({ name, hash, folderMillis }) => ({
          name,
          hash,
          createdAt: folderMillis,
        }),
      ),
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `baseline: wrote ${record.tag} from ${record.cutoff} (${reparsed.length} CHECKs in their authored text)\n`,
  );
} finally {
  await oldWay.drop();
  await superseded.close();
}
