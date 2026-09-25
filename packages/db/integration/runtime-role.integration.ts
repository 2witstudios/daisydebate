import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '../src/index';

setupRitewayBun();

const { databaseUrl: ownerUrl } = requireTestServices(process.env);

/**
 * Runs the check through `createDatabase` on one owner connection, as the
 * owner or after `set role`, so `current_user` is exactly the role Fly's
 * DATABASE_URL would log in as. No role is created or dropped: role DDL is
 * cluster-wide and would reach every other slot's suites.
 */
const problemsAs = async (role: 'owner' | 'daisy_web') => {
  const client = new SQL(ownerUrl, { max: 1 });
  const database = createDatabase({
    url: ownerUrl,
    client,
    nextActorId: createId,
  });
  try {
    if (role === 'daisy_web') await client.unsafe('set role daisy_web');
    return await database.runtimeRoleProblems();
  } finally {
    await database.close();
  }
};

/**
 * ISSUE-39: the check production startup runs, against the real catalog of
 * the migrated test database, as the migration owner and as daisy_web.
 */
test('refuses the migration owner and accepts daisy_web', async () => {
  const [owner, runtime] = [
    await problemsAs('owner'),
    await problemsAs('daisy_web'),
  ];
  assert({
    given: 'the migration owner and the daisy_web runtime role',
    should:
      'report the owner as able to create and own schema objects, and nothing for daisy_web',
    actual: {
      ownerRefused: owner.length > 0,
      ownerOwnsObjects: owner.some((problem) =>
        /^owns \d+ objects in schema public$/.test(problem),
      ),
      runtime,
    },
    expected: { ownerRefused: true, ownerOwnsObjects: true, runtime: [] },
  });
});
