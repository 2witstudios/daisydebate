import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { readBaselineRecord } from '../src/baseline/baseline-record';
import { supersededFolders } from '../src/baseline/superseded-folders';
import {
  catalogDifferences,
  describeCatalogDifference,
  readSchemaCatalog,
} from '../src/schema-catalog';
import { catalogAt, rowsAt } from './schema-catalog.test-support';
import { scratchDatabase } from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

/** Building the old history applies 153 folders; give it room. */
const historyTimeoutMs = 240_000;

const record = await readBaselineRecord();
const oldWay = scratchDatabase(databaseUrl, 'baselineold');
const baseline = scratchDatabase(databaseUrl, 'baselinenew');
afterAll(async () => {
  await oldWay.drop();
  await baseline.drop();
});

const built = (async () => {
  const superseded = await supersededFolders(record);
  try {
    await Promise.all([oldWay.create(), baseline.create()]);
    await Promise.all([
      oldWay.migrateFolder(superseded.folder),
      baseline.migrate((folder) => folder === record.tag),
    ]);
  } finally {
    await superseded.close();
  }
})();

test(
  'the baseline reproduces the catalog of the old history through the cut-off (RECON-5.1)',
  async () => {
    await built;
    const differences = catalogDifferences(
      await catalogAt(oldWay.url),
      await catalogAt(baseline.url),
    ).map(describeCatalogDifference);
    assert({
      given: `a database migrated the old way through ${record.cutoff} and one built from ${record.tag}`,
      should: 'hold the same catalog, entry for entry',
      actual: differences,
      expected: [],
    });
  },
  historyTimeoutMs,
);

test(
  'the baseline holds the reference rows the old history inserted',
  async () => {
    await built;
    const [old, fresh] = [await rowsAt(oldWay.url), await rowsAt(baseline.url)];
    const differing = [...new Set([...old.keys(), ...fresh.keys()])].filter(
      (table) => old.get(table) !== fresh.get(table),
    );
    assert({
      given: 'every table of both databases',
      should: 'hold the same rows',
      actual: differing,
      expected: [],
    });
  },
  historyTimeoutMs,
);

test(
  'the comparison names a policy, a grant and a trigger that differ',
  async () => {
    await built;
    const client = new SQL(baseline.url, { max: 1 });
    try {
      const [target] = (await client`
        select p.polname as policy, c.relname as "table",
          (select t.tgname from pg_trigger t join pg_class r on r.oid = t.tgrelid
           where not t.tgisinternal order by 1 limit 1) as trigger,
          (select r.relname from pg_trigger t join pg_class r on r.oid = t.tgrelid
           where not t.tgisinternal order by t.tgname limit 1) as "triggerTable"
        from pg_policy p join pg_class c on c.oid = p.polrelid
        order by 1 limit 1`) as {
        policy: string;
        table: string;
        trigger: string;
        triggerTable: string;
      }[];
      if (!target) throw new Error('The baseline holds no policy');
      await client.begin(async (tx) => {
        await tx.unsafe(`drop policy "${target.policy}" on public."${target.table}"`);
        await tx.unsafe(`grant select on public."${target.table}" to daisy_realtime`);
        await tx.unsafe(
          `alter table public."${target.triggerTable}" disable trigger "${target.trigger}"`,
        );
        const keys = catalogDifferences(
          await catalogAt(oldWay.url),
          await readCatalogIn(tx),
        ).map(({ key }) => key);
        assert({
          given: 'the baseline with one policy dropped, one grant added and one trigger disabled',
          should: 'name each changed entry',
          actual: keys,
          expected: [
            `policy public.${target.table}.${target.policy}`,
            `relation public.${target.table}`,
            `trigger public.${target.triggerTable}.${target.trigger}`,
          ].sort(),
        });
        throw rollback;
      }).catch((error: unknown) => {
        if (error !== rollback) throw error;
      });
    } finally {
      await client.close();
    }
  },
  historyTimeoutMs,
);

const rollback = Symbol('rollback');

const readCatalogIn = (tx: SQL) => readSchemaCatalog(drizzle({ client: tx }));
