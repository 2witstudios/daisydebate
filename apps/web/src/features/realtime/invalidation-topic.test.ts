import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  buildChannelTopic,
  ENVELOPE_VERSION,
  type ServerMessage,
} from '@daisy/protocol';
import { attachInvalidationTopic } from './invalidation-topic';

setupRitewayBun();

const topic = buildChannelTopic('c'.repeat(24));
const refusal = (code: 'AUTHORIZATION' | 'INFRASTRUCTURE'): ServerMessage => ({
  v: ENVELOPE_VERSION,
  type: 'error',
  id: 'sub-1',
  code,
  message: 'Subscription refused',
});

function attached() {
  let onTopic: (frame: ServerMessage) => void = () => {};
  let onMessage: (frame: ServerMessage) => void = () => {};
  const calls: string[] = [];
  const observer = attachInvalidationTopic({
    topic,
    matches: () => false,
    connection: {
      subscribeTopic: (_topic, listener) => {
        onTopic = listener;
        return () => {};
      },
      onMessage: (listener) => {
        onMessage = listener;
        return () => {};
      },
      resubscribeTopic: () => calls.push('resubscribe'),
    },
    invalidate: () => calls.push('clear'),
    refetch: () => calls.push('refetch'),
  });
  const deliver = (frame: ServerMessage) => {
    onTopic(frame);
    onMessage(frame);
  };
  return { observer, calls, deliver };
}

test('a terminal denial clears the view and cancels a pending recovery', () => {
  const { observer, calls, deliver } = attached();
  deliver({ v: ENVELOPE_VERSION, type: 'resync_required', id: 'sub-1', topic });
  deliver(refusal('AUTHORIZATION'));
  observer.authorizedSnapshot();
  assert({
    given:
      'a resync followed by a definitive AUTHORIZATION end of the subscription',
    should: 'clear and reread the view, and never resubscribe',
    actual: calls,
    expected: ['clear', 'refetch', 'clear', 'refetch'],
  });
});

test('an unavailable refusal still recovers after an authorized snapshot', () => {
  const { observer, calls, deliver } = attached();
  deliver(refusal('INFRASTRUCTURE'));
  observer.authorizedSnapshot();
  assert({
    given: 'a transient INFRASTRUCTURE refusal',
    should: 'reread, then resubscribe once authority is proven again',
    actual: calls,
    expected: ['clear', 'refetch', 'resubscribe'],
  });
});
