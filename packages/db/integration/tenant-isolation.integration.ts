import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { createDatabase } from '../src/index';
import {
  readTenantIsolationProblems,
  tenantIsolationFactsSql,
  tenantIsolationProblems,
  type TenantTableFacts,
} from '../src/tenant-isolation';
import { tenantIsolationManifest } from '../src/tenant-isolation-manifest';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
import { integrationSuite } from './suite.test-support';
import { inRolledBackTransaction } from './tab.test-support';

const { databaseUrl: url } = integrationSuite();

const schema = '20261114044129_tab_schema';
const scratch = scratchDatabase(url, 'tenantisolation');
afterAll(() => scratch.drop());

const problemsOf = async (databaseUrl: string) => {
  const sql = new SQL(databaseUrl, { max: 1 });
  try {
    return await readTenantIsolationProblems((statement) =>
      sql.unsafe(statement),
    );
  } finally {
    await sql.close();
  }
};

/**
 * TAB-4.1 and half of the schema slice's proof of done: the isolation check
 * passes on the migrated schema, read as production start-up and
 * `bun doctor` read it.
 */
test('the migrated schema is fenced exactly as the manifest declares', async () => {
  const database = createDatabase({ url, nextActorId: createId });
  try {
    assert({
      given: 'every committed migration applied to an empty database',
      should: 'report no tenant isolation problem',
      actual: await database.tenantIsolationProblems(),
      expected: [],
    });
  } finally {
    await database.close();
  }
});

test(
  'the isolation check passes after each migration step, and not before the schema exists',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < schema);
    const before = await problemsOf(scratch.url);
    await scratch.migrate((folder) => folder <= schema);
    const afterSchema = await problemsOf(scratch.url);
    await scratch.migrate(() => true);
    const afterAllFolders = await problemsOf(scratch.url);
    assert({
      given:
        'a database migrated to the folder before the tab schema, then to it, then to the end',
      should:
        'report every declared table missing before, and nothing after each step',
      actual: {
        before: before.length,
        firstBefore: before[0],
        afterSchema,
        afterAllFolders,
      },
      expected: {
        before:
          tenantIsolationManifest.tables.length +
          // rooms, seasons and the other altered tables exist already.
          0,
        firstBefore: 'organizations is declared but does not exist',
        afterSchema: [],
        afterAllFolders: [],
      },
    });
  },
  ddlTimeoutMs,
);

/** The check's report after one fault, made in a transaction that is rolled back. */
const afterFault = (fault: string) =>
  new Promise<readonly string[]>((resolve, reject) => {
    inRolledBackTransaction(url, async (sql) => {
      await sql.unsafe(fault);
      resolve(
        tenantIsolationProblems(
          (await sql.unsafe(
            tenantIsolationFactsSql,
          )) as readonly TenantTableFacts[],
          tenantIsolationManifest,
        ),
      );
    }).catch(reject);
  });

/** TAB-4.2 and TAB-4.22: each fault, made on purpose, is reported. */
test('a tenant-owned table with no policy or a wrong one is reported', async () => {
  assert({
    given:
      'row-level security switched off on one table, a policy dropped from another and a policy expression widened on a third',
    should: 'report each fault and nothing else',
    actual: [
      await afterFault('alter table events disable row level security'),
      await afterFault('drop policy grants_subject on grants'),
      await afterFault(
        'alter policy fixtures_scope on fixtures using (true)',
      ),
    ],
    expected: [
      ['events does not have row-level security enabled'],
      [
        'grants lacks the policy grants_subject for select using (user_id = daisy_subject_scope()) with check nothing',
      ],
      [
        'fixtures lacks the policy fixtures_scope for all using (lobby_id = daisy_lobby_scope()) with check (lobby_id = daisy_lobby_scope())',
        'fixtures has an undeclared policy: fixtures_scope for all using true with check (lobby_id = daisy_lobby_scope())',
      ],
    ],
  });
});

test('a table that carries or references a tenant key undeclared is reported', async () => {
  assert({
    given:
      'a new child table missing its key, a new table with a lobby_id column, and a new table with a tournament_id column',
    should: 'report each',
    actual: [
      await afterFault(
        'create table venues (id text primary key, event_id text references events (id))',
      ),
      await afterFault(
        'create table check_ins (id text primary key, lobby_id text not null)',
      ),
      await afterFault(
        'create table awards (id text primary key, tournament_id text)',
      ),
    ],
    expected: [
      ['venues references events but is neither tenant-owned nor exempt'],
      ['check_ins carries lobby_id but is neither tenant-owned nor exempt'],
      ['awards has a tournament_id column: a tournament is a lobby'],
    ],
  });
});

test('a nullable isolation key outside a declared one-of-two CHECK is reported', async () => {
  assert({
    given:
      'a lobby-keyed table whose key becomes nullable, and a one-of-two table whose CHECK is dropped',
    should: 'report each',
    actual: [
      await afterFault('alter table releases alter column lobby_id drop not null'),
      await afterFault(
        'alter table action_history drop constraint action_history_one_tenant_key',
      ),
    ],
    expected: [
      ['releases.lobby_id is nullable'],
      [
        'action_history carries a nullable isolation key without the action_history_one_tenant_key CHECK',
      ],
    ],
  });
});

test('a privilege for the realtime role or PUBLIC on a tenant-owned table is reported', async () => {
  assert({
    given: 'SELECT on results granted to daisy_realtime, and to PUBLIC',
    should: 'report each grantee',
    actual: [
      await afterFault('grant select on results to daisy_realtime'),
      await afterFault('grant select (id) on results to public'),
    ],
    expected: [
      ['daisy_realtime holds a privilege on results'],
      ['PUBLIC holds a privilege on results'],
    ],
  });
});
