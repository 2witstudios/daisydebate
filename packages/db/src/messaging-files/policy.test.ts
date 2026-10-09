import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireFilePolicy } from './policy';
setupRitewayBun();
test('missing and malformed file policy fails closed', async () => {
  for (const policy of [undefined, {}])
    await assertRejects({
      given: 'no complete owner supplied numeric policy',
      should: 'remain unavailable',
      actual: () =>
        requireFilePolicy(policy as Parameters<typeof requireFilePolicy>[0]),
      code: 'INFRASTRUCTURE',
    });
  assert({
    given: 'explicit integer policy validation',
    should: 'have no production default',
    actual: requireFilePolicy.length,
    expected: 1,
  });
});
