import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingInboxSchemas } from './inbox';
setupRitewayBun();
test('authorized group conversation navigation remains distinct from invitation or DM grants', () => {
  const result = createMessagingInboxSchemas(3).result.safeParse({
    version: 1,
    entries: [{ channelId: 'c'.repeat(24), kind: 'group_conversation' }],
    nextAfter: null,
  });
  assert({
    given: 'separately authorized private-group conversation',
    should:
      'retain its kind for membership navigation without title/member data',
    actual: result.success,
    expected: true,
  });
});
