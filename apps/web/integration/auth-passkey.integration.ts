import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '@daisy/db';
import { createTestAuthServer } from './auth-helpers';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

/** The subset of the Better Auth runtime adapter these records exercise. */
type AuthAdapter = {
  create: (input: {
    model: string;
    data: Record<string, unknown>;
  }) => Promise<unknown>;
  findOne: (input: {
    model: string;
    where: { field: string; operator: string; value: unknown }[];
  }) => Promise<unknown>;
  update: (input: {
    model: string;
    where: { field: string; operator: string; value: unknown }[];
    update: Record<string, unknown>;
  }) => Promise<unknown>;
  delete: (input: {
    model: string;
    where: { field: string; operator: string; value: unknown }[];
  }) => Promise<unknown>;
};

/**
 * The runtime adapter (with create/findOne/update/delete) lives on the
 * Better Auth context bound to the same Bun SQL pool.
 */
const runtimeAdapter = async (database: ReturnType<typeof createDatabase>) => {
  const auth = createTestAuthServer(database.authAdapter, { sent: [] });
  const context = (await auth.instance.$context) as { adapter: AuthAdapter };
  return context.adapter;
};

// The subject here is durable passkey-record persistence, not a login
// journey: the owning user is a labeled test fixture row, not a session.
const createFixtureUser = async (probe: SQL) => {
  const userId = createId();
  await probe.unsafe(
    "insert into users (id, username, email, email_verified, name) values ($1, $2, null, false, '')",
    [userId, `passkey-${userId}`],
  );
  return userId;
};

const passkeyData = (userId: string, credentialID: string) => ({
  name: 'Laptop',
  publicKey: `pk-${createId()}${createId()}`,
  userId,
  credentialID,
  counter: 0,
  deviceType: 'singleDevice',
  backedUp: false,
  transports: 'internal',
});

const rowCount = async (query: string, params: unknown[]) => {
  const probe = new SQL(url);
  try {
    const rows = await probe.unsafe(query, params);
    return rows[0]?.c ?? 0;
  } finally {
    await probe.close();
  }
};

test('passkey records round-trip through the Better Auth adapter on the shared pool', async () => {
  const database = createDatabase({ url });
  const adapter = await runtimeAdapter(database);
  const fixture = new SQL(url);
  let userId: string | undefined;
  try {
    userId = await createFixtureUser(fixture);
    const credentialId = `cred-${createId()}${createId()}`;
    const passkey = (await adapter.create({
      model: 'passkey',
      data: passkeyData(userId, credentialId),
    })) as { id: string; credentialID: string; userId: string };
    const found = (await adapter.findOne({
      model: 'passkey',
      where: [{ field: 'credentialID', operator: 'eq', value: credentialId }],
    })) as { id: string } | null;
    const renamed = (await adapter.update({
      model: 'passkey',
      where: [{ field: 'id', operator: 'eq', value: passkey.id }],
      update: { name: 'Roaming key' },
    })) as { name: string } | null;
    assert({
      given: 'a passkey record created through the auth adapter',
      should: 'be retrievable by credential and renamable in place',
      actual: {
        cuid2Id: /^[a-z0-9]{24}$/.test(passkey.id),
        ownedByFixtureUser: passkey.userId === userId,
        foundByCredential: found?.id === passkey.id,
        renamed: renamed?.name,
      },
      expected: {
        cuid2Id: true,
        ownedByFixtureUser: true,
        foundByCredential: true,
        renamed: 'Roaming key',
      },
    });

    let duplicateRejected = false;
    try {
      await adapter.create({
        model: 'passkey',
        data: passkeyData(userId, credentialId),
      });
    } catch {
      duplicateRejected = true;
    }
    let foreignKeyRejected = false;
    try {
      await adapter.create({
        model: 'passkey',
        data: passkeyData(createId(), `cred-${createId()}${createId()}`),
      });
    } catch {
      foreignKeyRejected = true;
    }
    assert({
      given: 'duplicate credentials or unknown owners',
      should: 'reject on credential uniqueness and the user foreign key',
      actual: { duplicateRejected, foreignKeyRejected },
      expected: { duplicateRejected: true, foreignKeyRejected: true },
    });

    await adapter.delete({
      model: 'passkey',
      where: [{ field: 'id', operator: 'eq', value: passkey.id }],
    });
    const gone = await adapter.findOne({
      model: 'passkey',
      where: [{ field: 'id', operator: 'eq', value: passkey.id }],
    });
    assert({
      given: 'removal of an owned passkey record',
      should: 'delete durably so neither the adapter nor storage finds it',
      actual: {
        goneAfterDelete: gone,
        rowsRemaining: await rowCount(
          'select count(*)::int as c from passkey where user_id = $1',
          [userId],
        ),
      },
      expected: { goneAfterDelete: null, rowsRemaining: 0 },
    });
  } finally {
    if (userId)
      await fixture.unsafe('delete from users where id = $1', [userId]);
    await fixture.close();
    await database.close();
  }

  assert({
    given: 'the bounded fixture cleanup after the passkey round trip',
    should: 'leave no fixture records behind',
    actual: {
      usersRemaining: await rowCount(
        'select count(*)::int as c from users where id = $1',
        [userId],
      ),
      passkeysRemaining: await rowCount(
        'select count(*)::int as c from passkey where user_id = $1',
        [userId],
      ),
    },
    expected: { usersRemaining: 0, passkeysRemaining: 0 },
  });
});
