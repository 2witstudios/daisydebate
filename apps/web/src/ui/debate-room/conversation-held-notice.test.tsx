import { assert, setupRitewayBun, test } from 'riteway/bun';
import { conversational } from '@daisy/protocol/runtime';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { ConversationHeldNotice } from './conversation-held-notice';
import { view } from './live-round.test-support';

setupRitewayBun();

test('conversational is the pre-Round wait and the wait for a ballot, never a speech', () => {
  const at = (over: object) =>
    conversational({
      stage: null,
      openSegment: null,
      nextSegment: null,
      ...over,
    } as never);
  assert({
    given:
      'awaiting a ballot, before the first segment, between segments, and in speech',
    should: 'open conversation only in the first two',
    actual: [
      at({ stage: 'awaiting_ballot' }),
      at({ nextSegment: { sequence: 0 } }),
      at({ nextSegment: { sequence: 3 } }),
      at({ openSegment: { key: 's' } }),
    ],
    expected: [true, true, false, false],
  });
});

test('the notice appears only when conversation is really being held', () => {
  const text = (over: object) =>
    renderAccessible(
      <ConversationHeldNotice view={{ ...view, ...over } as never} nowMs={0} />,
    ).textContent();
  assert({
    given: 'a Round whose conversation is not held',
    should: 'say nothing',
    actual: text({ conversationHeld: false }),
    expected: '',
  });
});
