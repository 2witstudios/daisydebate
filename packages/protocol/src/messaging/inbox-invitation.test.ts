import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingInboxSchemas } from './inbox';
setupRitewayBun();
test('pending own group invitation is a minimal inbox navigation candidate', () => {
  const schemas = createMessagingInboxSchemas(3),
    channelId = 'g'.repeat(24);
  for (const [extra, expected] of [
    [{}, true],
    [{ title: 'Private title' }, false],
    [{ memberActorIds: ['i'.repeat(24)] }, false],
  ] as const) {
    assert({
      given: 'an invitation navigation projection',
      should:
        'admit only the minimal invitation kind without content or membership',
      actual: schemas.result.safeParse({
        version: 1,
        entries: [{ channelId, kind: 'incoming_invitation', ...extra }],
        nextAfter: null,
      }).success,
      expected,
    });
  }
});
