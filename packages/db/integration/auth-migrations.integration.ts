import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import {
  asJson,
  createScratchDatabase,
  dropScratchDatabase,
  journalCount,
  legacyDebateCreatedAt,
  legacyDebateId,
  legacySnapshot,
  legacyUserCreatedAt,
  legacyUserUpdatedAt,
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

const legacyUserRowQuery = `select id, username, email, email_verified, name, created_at, updated_at, version
  from users where id = $1`;
const legacyDebateRowQuery = `select id, created_by, resolution, format, snapshot, created_at, updated_at, version
  from debates where id = $1`;

test('populated pre-auth databases upgrade forward without losing identity', async () => {
  const name = newScratchName();
  await createScratchDatabase(testDatabaseUrl, name);
  try {
    await seedPreAuthState(testDatabaseUrl, name, [
      [legacyUserId, 'Aurora'],
      ['1c2c3c4c-5c6c-4c7c-8c9c-0c1c2c3c4c5c', 'Borealis'],
    ]);
    const migrateClient = new SQL(scratchUrl(testDatabaseUrl, name), {
      max: 1,
    });
    const database = drizzle(migrateClient);
    await migrate(database, { migrationsFolder: migrationsDir });

    const user = await scalar(testDatabaseUrl, name, legacyUserRowQuery, [
      legacyUserId,
    ]);
    assert({
      given: 'a legacy username-only user after the forward migration',
      should: 'preserve id, username, timestamps and defaults verbatim',
      actual: {
        id: user.id,
        username: user.username,
        email: user.email,
        emailVerified: user.email_verified,
        name: user.name,
        createdAt: user.created_at.toISOString(),
        updatedAt: user.updated_at.toISOString(),
        version: user.version,
      },
      expected: {
        id: legacyUserId,
        username: 'Aurora',
        email: null,
        emailVerified: false,
        name: '',
        createdAt: legacyUserCreatedAt,
        updatedAt: legacyUserUpdatedAt,
        version: 1,
      },
    });

    const debate = await scalar(testDatabaseUrl, name, legacyDebateRowQuery, [
      legacyDebateId,
    ]);
    assert({
      given: 'a legacy debate after the forward migration',
      should: 'preserve identity, ownership reference, history and snapshot',
      actual: {
        id: debate.id,
        createdBy: debate.created_by,
        resolution: debate.resolution,
        format: debate.format,
        snapshot: asJson(debate.snapshot),
        createdAt: debate.created_at.toISOString(),
        version: debate.version,
      },
      expected: {
        id: legacyDebateId,
        createdBy: legacyUserId,
        resolution: legacySnapshot.resolution,
        format: 'foundation',
        snapshot: legacySnapshot,
        createdAt: legacyDebateCreatedAt,
        version: 1,
      },
    });
    await assertPreservedSchema(testDatabaseUrl, name);
    await assertRestrictiveDeletion(testDatabaseUrl, name);

    assert({
      given: 'the migration journal after the forward migration',
      should: 'record exactly the three committed migrations in order',
      actual: await journalCount(testDatabaseUrl, name),
      expected: 3,
    });

    // Repeated application is stable: 0002 is already recorded as applied.
    await migrate(database, { migrationsFolder: migrationsDir });
    const afterRepeat = await scalar(
      testDatabaseUrl,
      name,
      legacyUserRowQuery,
      [legacyUserId],
    );
    assert({
      given: 'a repeated forward migration application',
      should: 'leave journal depth and preserved timestamps stable',
      actual: {
        journalCount: await journalCount(testDatabaseUrl, name),
        userCreatedAt: afterRepeat.created_at.toISOString(),
      },
      expected: {
        journalCount: 3,
        userCreatedAt: legacyUserCreatedAt,
      },
    });

    await assertCuid2WritesOnUpgradedSchema(testDatabaseUrl, name);
    await migrateClient.close();
  } finally {
    await dropScratchDatabase(testDatabaseUrl, name);
  }
});

const assertPreservedSchema = async (url: string, name: string) => {
  const authTables = await Promise.all(
    ['account', 'session', 'verification', 'passkey'].map((table) =>
      scalar(url, name, 'select to_regclass($1) as regclass', [
        `public.${table}`,
      ]),
    ),
  );
  assert({
    given: 'the auth persistence tables after the forward migration',
    should: 'exist alongside the preserved legacy data',
    actual: authTables.map(({ regclass }) => regclass),
    expected: ['account', 'session', 'verification', 'passkey'],
  });
};

const assertRestrictiveDeletion = async (url: string, name: string) => {
  // Bun SQL maps the server SQLSTATE to `errno` (23001 restrict_violation)
  // and carries the violated constraint's name.
  let restrictError: { errno?: string | number; constraint?: string } = {};
  try {
    await scalar(url, name, 'delete from users where id = $1', [legacyUserId]);
  } catch (error) {
    restrictError = error as { errno?: string | number; constraint?: string };
  }
  assert({
    given: 'a deletion attempt against a user referenced by a debate',
    should: 'stay restrictive with the original foreign-key constraint',
    actual: {
      errno: String(restrictError.errno),
      constraint: restrictError.constraint,
    },
    expected: {
      errno: '23001',
      constraint: 'debates_created_by_users_id_fk',
    },
  });
};

const assertCuid2WritesOnUpgradedSchema = async (url: string, name: string) => {
  const upgraded = createDatabase({ url: scratchUrl(url, name) });
  try {
    const newUserId = createId();
    const newDebateId = createId();
    await upgraded.createUser({ id: newUserId, username: 'postcuid2' });
    await upgraded.createDebate({
      id: newDebateId,
      createdBy: newUserId,
      resolution: 'Post-upgrade debate',
      format: 'foundation',
      snapshot: { version: 1, id: newDebateId },
    });
    assert({
      given: 'cuid2 records created on the upgraded database',
      should: 'round-trip alongside the preserved legacy identities',
      actual: {
        newDebateOwner: (await upgraded.getDebate(newDebateId))?.createdBy,
        legacyDebateReadable: (await upgraded.getDebate(legacyDebateId))?.id,
      },
      expected: {
        newDebateOwner: newUserId,
        legacyDebateReadable: legacyDebateId,
      },
    });
  } finally {
    await upgraded.close();
  }
};
