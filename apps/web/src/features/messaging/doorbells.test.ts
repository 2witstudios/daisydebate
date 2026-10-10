import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ServerMessage } from '@daisy/protocol';
import {
  buildChannelTopic,
  buildUserInboxTopic,
  ENVELOPE_VERSION,
} from '@daisy/protocol';
import {
  attachMessagingDoorbells,
  attachMessagingInboxDoorbells,
} from './doorbells';
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
  listener({
    v: ENVELOPE_VERSION,
    type: 'resync_required',
    id: 'sub-1',
    topic,
  });
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

test('owner inbox bell never interprets a foreign owner or a notification delta as messaging content', () => {
  const actorId = 'a'.repeat(24);
  let emit: (frame: ServerMessage) => void = () => {};
  const calls: string[] = [];
  const observer = attachMessagingInboxDoorbells({
    actorId,
    connection: {
      subscribeTopic: (topic, listener) => {
        calls.push(topic);
        emit = listener;
        return () => {};
      },
      onMessage: () => () => {},
      resubscribeTopic: () => {},
    },
    invalidate: () => calls.push('clear'),
    refetch: () => calls.push('read'),
  });
  for (const owner of ['b'.repeat(24), actorId])
    emit({
      v: ENVELOPE_VERSION,
      type: 'event',
      topic: buildUserInboxTopic(owner),
      position: '1:2',
      payload: { kind: 'messaging.inbox.changed' },
    });
  assert({
    given: 'foreign then actual owner activity',
    should:
      'invalidate once and authorize via HTTP instead of taking content from the event',
    actual: calls,
    expected: [buildUserInboxTopic(actorId), 'clear', 'read'],
  });
  observer.close();
});
