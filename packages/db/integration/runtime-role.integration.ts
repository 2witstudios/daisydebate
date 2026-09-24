import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '../src/index';

setupRitewayBun();

const { databaseUrl: ownerUrl } = requireTestServices(process.env);

const problemsAs = async (url: string) => {
  const database = createDatabase({
    url,
    maxConnections: 1,
    nextActorId: createId,
  });
  try {
    return await database.runtimeRoleProblems();
  } finally {
    await database.close();
  }
};

/**
 * ISSUE-39: the check production startup runs, against the real catalog of
 * the migrated test database, logged in as the migration owner and as a
 * real login that holds only daisy_web, the way Fly's DATABASE_URL does.
 */
test('refuses the migration owner and accepts a daisy_web login', async () => {
  // CSPRNG role name and password: this login lives only for this test.
  const user = `runtime_probe_${createId()}`;
  const password = createId();
  const admin = new SQL(ownerUrl, { max: 1 });
  try {
    await admin.unsafe(`create role "${user}" login password '${password}'`);
    await admin.unsafe(`grant daisy_web to "${user}"`);
    const runtimeUrl = new URL(ownerUrl);
    runtimeUrl.username = user;
    runtimeUrl.password = password;
    const [owner, runtime] = [
      await problemsAs(ownerUrl),
      await problemsAs(runtimeUrl.toString()),
    ];
    assert({
      given: 'the migration owner and a login that is a member of daisy_web',
      should:
        'report the owner as able to create and own schema objects, and nothing for the runtime login',
      actual: {
        ownerRefused: owner.length > 0,
        ownerOwnsObjects: owner.some((problem) =>
          /^owns \d+ objects in schema public$/.test(problem),
        ),
        runtime,
      },
      expected: { ownerRefused: true, ownerOwnsObjects: true, runtime: [] },
    });
  } finally {
    await admin.unsafe(`drop role if exists "${user}"`);
    await admin.close();
  }
});
