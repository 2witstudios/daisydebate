import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingCoreSchemas } from '@daisy/protocol';
import { messagingMarkReadBody } from './mark-read';
setupRitewayBun();
test('the browser read body is a valid mark-read command for its own channel', () => {
  const channelId = 'c'.repeat(24);
  const { markRead } = createMessagingCoreSchemas({
    messageUnits: 10,
    pageItems: 10,
  });
  assert({
    given: 'a channel read through sequence 7',
    should: 'pass the mark-read contract, cursor bound to the same channel',
    actual: markRead.safeParse(messagingMarkReadBody(channelId, 7)).success,
    expected: true,
  });
});
