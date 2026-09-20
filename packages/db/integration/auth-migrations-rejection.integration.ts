import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createScratchDatabase,
  dropScratchDatabase,
  journalCount,
  legacySecondUserId,
  legacyUserId,
  migrationsDir,
  newScratchName,
  scalar,
  scratchUrl,
  seedPreAuthState,
} from './migration-support';

setupRitewayBun();

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(testDatabaseUrl).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

const authTableRegclasses = async (url: string, name: string) =>
  Promise.all(
    ['account', 'session', 'verification', 'passkey'].map((table) =>
      scalar(url, name, 'select to_regclass($1) as regclass', [
        `public.${table}`,
      ]),
    ),
  );

const legacyUsers = async (url: string, name: string) => {
  const client = new SQL(scratchUrl(url, name));
  try {
    const rows = await client.unsafe(
      'select id, username from users order by id',
    );
    return (rows as { id: string; username: string }[]).map(
      ({ id, username }) => ({ id, username }),
    );
  } finally {
    await client.close();
  }
};

test('case-fold username collisions reject the whole forward migration atomically', async () => {
  const name = newScratchName();
  await createScratchDatabase(testDatabaseUrl, name);
  await seedPreAuthState(testDatabaseUrl, name, [
    [legacyUserId, 'Aurora'],
    [legacySecondUserId, 'aurora'],
  ]);
  try {
    let rejected = false;
    const migrateClient = new SQL(scratchUrl(testDatabaseUrl, name), {
      max: 1,
    });
    const database = drizzle(migrateClient);
    try {
      await migrate(database, { migrationsFolder: migrationsDir });
    } catch {
      rejected = true;
    }

    const authTables = await authTableRegclasses(testDatabaseUrl, name);
    const usersShape = await scalar(
      testDatabaseUrl,
      name,
      `select is_nullable from information_schema.columns
       where table_name = 'users' and column_name = 'username'`,
    );
    const emailColumn = await scalar(
      testDatabaseUrl,
      name,
      `select column_name from information_schema.columns
       where table_name = 'users' and column_name = 'email'`,
    );
    assert({
      given: 'a populated database with case-folded username collisions',
      should:
        'reject the forward migration before any schema or journal change',
      actual: {
        rejected,
        authTables: authTables.map(({ regclass }) => regclass),
        usernameNullable: usersShape?.is_nullable,
        emailColumn: emailColumn?.column_name,
        journalCount: await journalCount(testDatabaseUrl, name),
        users: await legacyUsers(testDatabaseUrl, name),
      },
      expected: {
        rejected: true,
        authTables: [null, null, null, null],
        usernameNullable: 'NO',
        emailColumn: undefined,
        journalCount: 2,
        users: [
          { id: legacySecondUserId, username: 'aurora' },
          { id: legacyUserId, username: 'Aurora' },
        ],
      },
    });
    await migrateClient.close();
  } finally {
    await dropScratchDatabase(testDatabaseUrl, name);
  }
});
