import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ServerMessage } from '@daisy/protocol';
import { buildUserInboxTopic, ENVELOPE_VERSION } from '@daisy/protocol';
import { attachMessagingInboxDoorbells } from './doorbells';
setupRitewayBun();
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
