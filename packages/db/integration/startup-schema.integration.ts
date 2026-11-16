import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, test } from 'riteway/bun';
import { databaseHealthOperations } from '../src/database-health';
import { runMigrations } from '../src/migrator';
import { refuseUnisolatedTenantTables } from '../src/tenant-isolation';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
import { sqlStateOf } from './constraint-helpers';
import { integrationSuite } from './suite.test-support';

const { databaseUrl } = integrationSuite();
const scratch = scratchDatabase(databaseUrl, 'startupimage');
afterAll(() => scratch.drop());

const startup = async (client: SQL) => {
  await client`set role daisy_web`;
  try {
    const database = databaseHealthOperations({
      database: drizzle({ client }),
      dedicated: client,
      eventSink: undefined,
    });
    await refuseUnisolatedTenantTables({
      config: { NODE_ENV: 'production' },
      database,
    });
    return 'started';
  } catch (error) {
    return (error as Error).message;
  } finally {
    await client`reset role`;
  }
};

test(
  'the runtime image accepts a real additive migration but refuses missing used columns and broken fences',
  async () => {
    await scratch.create();
    await scratch.migrate(() => true);
    const client = new SQL(scratch.url, { max: 1 });
    const folder = await mkdtemp(join(tmpdir(), 'daisy-startupimage-'));
    try {
      const current = await startup(client);
      await cp(new URL('../migrations/', import.meta.url), folder, {
        recursive: true,
      });
      const future = join(folder, '20990101000000_future_additions');
      await mkdir(future);
      await writeFile(
        join(future, 'migration.sql'),
        `
      create table future_checkins (id text primary key, lobby_id text not null references lobbies(id));
      alter table rooms add column future_label text;
      create function future_identity(value text) returns text language sql immutable as $$ select value $$;
    `,
      );
      await runMigrations({
        databaseUrl: scratch.url,
        migrationsFolder: folder,
      });
      const ahead = await startup(client);
      const health = databaseHealthOperations({
        database: drizzle({ client }),
        dedicated: client,
        eventSink: undefined,
      });
      const strict = await health.tenantIsolationProblems();
      await client`set role daisy_web`;
      const journalPrivileges = [
        await sqlStateOf(
          () =>
            client`select hash, created_at, id from drizzle.__drizzle_migrations limit 1`,
        ),
        await sqlStateOf(
          () => client`select name from drizzle.__drizzle_migrations limit 1`,
        ),
        await sqlStateOf(
          () => client`delete from drizzle.__drizzle_migrations where false`,
        ),
        await sqlStateOf(
          () =>
            client`update drizzle.__drizzle_migrations set hash = hash where false`,
        ),
      ];
      await client`reset role`;
      await client`alter table rooms rename column title to missing_title`;
      const missing = await startup(client);
      await client`alter table rooms rename column missing_title to title`;
      await client`alter table events disable row level security`;
      const fence = await startup(client);
      await client`alter table events enable row level security`;
      await client`update drizzle.__drizzle_migrations set hash = repeat('0', 64) where id = (select min(id) from drizzle.__drizzle_migrations)`;
      const history = await startup(client);
      const actual = {
        journalPrivileges,
        current,
        ahead,
        strict,
        missing: missing.includes(
          'rooms.title is required by this image but does not exist',
        ),
        fence: fence.includes(
          'events does not have row-level security enabled',
        ),
        history: history.includes(
          'Database migration history does not extend this image',
        ),
      };
      process.stdout.write(
        `STARTUP IMAGE RESULTS: ${JSON.stringify(actual)}\n`,
      );
      assert({
        given:
          'current, additively migrated, missing-column, broken-fence and divergent-history databases',
        should:
          'accept only complete compatible image requirements and retain strict authoring checks',
        actual,
        expected: {
          journalPrivileges: ['accepted', '42501', '42501', '42501'],
          current: 'started',
          ahead: 'started',
          strict: [
            'future_checkins carries lobby_id but is neither tenant-owned nor exempt',
          ],
          missing: true,
          fence: true,
          history: true,
        },
      });
      process.stdout.write(
        'STARTUP IMAGE: current and additive-ahead accepted as daisy_web; strict authoring, missing column, broken RLS and divergent history refusals proved\n',
      );
    } finally {
      await client.close();
      await rm(folder, { recursive: true, force: true });
    }
  },
  ddlTimeoutMs * 3,
);
