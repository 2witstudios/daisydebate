import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { cp, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { adoptBaseline } from '../src/baseline/adoption';
import { readBaselineRecord } from '../src/baseline/baseline-record';
import {
  migrateOldWay,
  supersededFolders,
} from '../src/baseline/superseded-history';
import { databaseHealthOperations } from '../src/database-health';
import { applyDevSeed } from '../src/dev-seed';
import { runMigrations } from '../src/migrator';
import { refuseUnisolatedTenantTables } from '../src/tenant-isolation';
import { validRules } from './round-fixtures';
import { scratchDatabase } from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

/** Building the old history applies 153 folders; give it room. */
const historyTimeoutMs = 240_000;
const migrationsFolder = new URL('../migrations', import.meta.url).pathname;
const record = await readBaselineRecord();
const live = scratchDatabase(databaseUrl, 'adoptlive');
const references: ReturnType<typeof scratchDatabase>[] = [];
afterAll(async () => {
  await live.drop();
  for (const reference of references) await reference.drop();
});

/** A new, empty reference database on the same cluster, as the runbook asks. */
const adopt = async () => {
  const reference = scratchDatabase(databaseUrl, 'adoptref');
  references.push(reference);
  await reference.create();
  return adoptBaseline({
    databaseUrl: live.url,
    referenceUrl: reference.url,
    migrationsFolder,
  });
};

/** Every row of every table, exactly: adoption writes none of them. */
const tableRows = async () => {
  const client = new SQL(live.url, { max: 1 });
  try {
    const tables = (await client`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`) as {
      name: string;
    }[];
    const digests: string[] = [];
    for (const { name } of tables) {
      const [row] = (await client.unsafe(
        `select count(*)::text || ':' || coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as digest
         from public."${name}" t`,
      )) as { digest: string }[];
      digests.push(`${name} ${row?.digest ?? ''}`);
    }
    return digests;
  } finally {
    await client.close();
  }
};

const journal = async () => {
  const client = new SQL(live.url, { max: 1 });
  try {
    return (
      (await client`
      select name from drizzle.__drizzle_migrations order by created_at, id`) as {
        name: string;
      }[]
    ).map(({ name }) => name);
  } finally {
    await client.close();
  }
};

/** What production start-up decides against this database, as daisy_web. */
const startup = async () => {
  const client = new SQL(live.url, { max: 1 });
  await client`set role daisy_web`;
  try {
    await refuseUnisolatedTenantTables({
      config: { NODE_ENV: 'production' },
      database: databaseHealthOperations({
        database: drizzle({ client }),
        dedicated: client,
        eventSink: undefined,
      }),
    });
    return 'started';
  } catch (error) {
    return (error as Error).message;
  } finally {
    await client`reset role`;
    await client.close();
  }
};

const live2 = (async () => {
  // The old history, then every folder the image adds after the baseline:
  // a database as staging holds it on the day of adoption.
  const superseded = await supersededFolders(record);
  try {
    for (const folder of (await readdir(migrationsFolder)).sort())
      if (folder !== record.tag)
        await cp(
          join(migrationsFolder, folder),
          join(superseded.folder, folder),
          {
            recursive: true,
          },
        );
    await live.create();
    await migrateOldWay({ databaseUrl: live.url, folder: superseded.folder });
  } finally {
    await superseded.close();
  }
  const actorId = 'a1d2o3p4t5s6e7e8d9a0c1t2';
  await applyDevSeed({
    url: live.url,
    seed: {
      name: 'baseline-adoption-test',
      version: '1',
      people: [
        {
          userId: 'a1d2o3p4t5s6e7e8d9u0s1r2',
          actorId,
          username: 'adoption-tester',
        },
      ],
      round: {
        id: 'a1d2o3p4t5s6e7e8d9r0n1d2',
        createdByActorId: actorId,
        resolution: 'Resolved: a journal swap keeps every row.',
        formatId: 'foundation',
        formatVersion: 1,
        rules: validRules,
        seats: [
          {
            id: 'a1d2o3p4t5s6e7e8d9s0t1a2',
            actorId,
            seat: { kind: 'side' as const, side: 'affirmative', slot: 0 },
          },
        ],
      },
    },
  });
})();

test(
  'a seeded database migrated the old way starts only on an old image before adoption',
  async () => {
    await live2;
    assert({
      given:
        'the seeded database before adoption, and this image (which starts from the baseline)',
      should: 'refuse start-up: the journal does not extend this image',
      actual: (await startup()).includes(
        'Database migration history does not extend this image',
      ),
      expected: true,
    });
  },
  historyTimeoutMs,
);

test(
  'adoption refuses a catalog that drifted from the baseline and changes nothing',
  async () => {
    await live2;
    const [rows, names] = [await tableRows(), await journal()];
    const client = new SQL(live.url, { max: 1 });
    try {
      await client`grant select on public.formats to daisy_realtime`;
      const outcome = await adopt();
      await client`revoke select on public.formats from daisy_realtime`;
      assert({
        given: 'the seeded database with one grant the baseline does not hold',
        should:
          'refuse, naming the table, and leave the journal and every row unchanged',
        actual: {
          kind: outcome.kind,
          named:
            outcome.kind === 'refused' &&
            outcome.reasons.some((reason) =>
              reason.startsWith('changed relation public.formats'),
            ),
          journal: (await journal()).join(),
          rows: (await tableRows()).join(),
        },
        expected: {
          kind: 'refused',
          named: true,
          journal: names.join(),
          rows: rows.join(),
        },
      });
    } finally {
      await client.close();
    }
  },
  historyTimeoutMs,
);

test(
  'adoption refuses a journal it does not know and changes nothing',
  async () => {
    await live2;
    const names = await journal();
    const client = new SQL(live.url, { max: 1 });
    try {
      await client`insert into drizzle.__drizzle_migrations (hash, created_at, name)
        values (${'f'.repeat(64)}, 4102444800000, '20991231000000_somewhere_else')`;
      const outcome = await adopt();
      await client`delete from drizzle.__drizzle_migrations where name = '20991231000000_somewhere_else'`;
      assert({
        given:
          'the seeded database whose journal records a folder this image does not hold',
        should: 'refuse and leave the journal unchanged',
        actual: { outcome, journal: (await journal()).join() },
        expected: {
          outcome: {
            kind: 'refused',
            reasons: [
              `Journal row ${names.length} records 20991231000000_somewhere_else, which is not the image's next folder after the baseline`,
            ],
          },
          journal: names.join(),
        },
      });
    } finally {
      await client.close();
    }
  },
  historyTimeoutMs,
);

test(
  'adoption swaps the journal, keeps every row, and the image then starts and has nothing to apply (RECON-5.2)',
  async () => {
    await live2;
    const [rows, names] = [await tableRows(), await journal()];
    const later = names.filter((name) => name > record.cutoff);
    const outcome = await adopt();
    const adopted = await journal();
    await runMigrations({ databaseUrl: live.url, migrationsFolder });
    assert({
      given:
        'the seeded database migrated the old way, adopted with an empty reference',
      should:
        'record the baseline in place of the superseded rows, keep the later ones and every row, start, and apply nothing',
      actual: {
        outcome,
        journal: adopted,
        rows: (await tableRows()).join(),
        startup: await startup(),
        afterMigrate: await journal(),
      },
      expected: {
        outcome: {
          kind: 'adopted',
          baseline: record.tag,
          superseded: names.length - later.length,
          later,
        },
        journal: [record.tag, ...later],
        rows: rows.join(),
        startup: 'started',
        afterMigrate: [record.tag, ...later],
      },
    });
  },
  historyTimeoutMs,
);

test(
  'adoption refuses a database that already records the baseline',
  async () => {
    await live2;
    assert({
      given: 'the adopted database',
      should: 'refuse a second adoption',
      actual: await adopt(),
      expected: {
        kind: 'refused',
        reasons: ['The journal already records the baseline; nothing to adopt'],
      },
    });
  },
  historyTimeoutMs,
);
