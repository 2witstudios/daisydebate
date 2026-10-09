import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ServerMessage } from '@daisy/protocol';
import { buildChannelTopic } from '@daisy/protocol';
import { attachMessagingDoorbells } from './doorbells';
setupRitewayBun();
test('channel resync clears content before refetch and retries only after an authorized snapshot', () => {
  const channelId = 'c'.repeat(24),
    topic = buildChannelTopic(channelId);
  let listener: (frame: ServerMessage) => void = () => {};
  const calls: string[] = [];
  const reader = attachMessagingDoorbells({
    channelId,
    connection: {
      subscribeTopic: (subscribed, callback) => {
        calls.push(subscribed);
        listener = callback;
        return () => calls.push('unsubscribe');
      },
      onMessage: () => () => {},
      resubscribeTopic: (subscribed) => calls.push(`retry:${subscribed}`),
    },
    invalidate: () => calls.push('clear'),
    refetch: () => calls.push('refetch'),
  });
  listener({ v: 1, type: 'resync_required', id: 'sub-1', topic });
  assert({
    given: 'a transport which cannot certify catchup',
    should:
      'clear before HTTP refetch and never manufacture a successful replay',
    actual: calls,
    expected: [topic, 'clear', 'refetch'],
  });
  reader.authorizedSnapshot();
  reader.close();
  assert({
    given: 'a newly authorized HTTP snapshot then reader disposal',
    should: 'retry without the old cursor and unsubscribe',
    actual: calls.slice(3),
    expected: [`retry:${topic}`, 'unsubscribe'],
  });
});
