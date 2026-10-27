import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readProfile } from '../src/features/profile/read-profile';
import { createTestApp } from './fixtures';

requireTestServices(process.env);
setupRitewayBun();
const { app } = createTestApp();

test('server-render profile reads consume a real shared Redis budget before PostgreSQL', async () => {
  const limiter = app.auth().limiter;
  let reads = 0;
  const store = {
    readMemberProfile: async (
      input: Parameters<typeof app.database.readMemberProfile>[0],
    ) => {
      reads += 1;
      return app.database.readMemberProfile(input);
    },
  };
  const input = {
    identity: { state: 'anonymous', principal: { kind: 'anonymous' } },
    username: 'missing-profile-budget-fixture',
    clientId: 'profile-budget-client',
    query: {},
  } as const;
  assert({
    given: 'an anonymous in-process profile read with capacity',
    should: 'reach the real profile query and report no matching account',
    actual: await readProfile({ store, limiter }, input),
    expected: null,
  });
  for (let used = 1; used < 60; used += 1)
    await limiter.consume('profile:read:client:profile-budget-client', {
      max: 60,
      windowSeconds: 60,
    });
  await assertRejects({
    given: 'the same render after its shared Redis budget is exhausted',
    should: 'refuse before another PostgreSQL profile query',
    actual: () =>
      readProfile({ store, limiter }, { ...input, username: 'another-name' }),
    code: 'RATE_LIMIT',
  });
  assert({
    given: 'one accepted and one refused anonymous server render',
    should: 'have called the real PostgreSQL profile operation exactly once',
    actual: reads,
    expected: 1,
  });
});
