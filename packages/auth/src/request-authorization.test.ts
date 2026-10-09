import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { authorizeRequest } from './request-authorization';
setupRitewayBun();
describe('request authority boundary', () => {
  test('unavailable identity performs no loader I/O', async () => {
    let reads = 0;
    await assertRejects({
      given: 'an unavailable session store',
      should: 'refuse infrastructure before resource access',
      actual: () =>
        authorizeRequest({
          identity: { state: 'unavailable', principal: { kind: 'anonymous' } },
          capability: 'room.read',
          load: async () => {
            reads++;
            return null;
          },
        }),
      code: 'INFRASTRUCTURE',
    });
    assert({
      given: 'an unavailable request',
      should: 'perform no resource work',
      actual: reads,
      expected: 0,
    });
  });
  test('missing and denied private reads share a public result', async () => {
    for (const load of [
      async () => null,
      async () => ({
        resource: {
          kind: 'room' as const,
          roomId: 'r',
          hostActorId: 'a',
          visibility: 'private' as const,
          status: 'assembling',
          revision: 1,
          participants: [],
        },
        context: { account: null },
      }),
    ])
      await assertRejects({
        given: 'missing or unauthorized Room',
        should: 'mask existence identically',
        actual: () =>
          authorizeRequest({
            identity: { state: 'anonymous', principal: { kind: 'anonymous' } },
            capability: 'room.read',
            load,
          }),
        code: 'NOT_FOUND',
      });
  });
});
