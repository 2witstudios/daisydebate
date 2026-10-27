import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingCoreSchemas } from '@daisy/protocol';
import { formReadThrough, messagingMarkReadBody } from './mark-read';
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

test('a native form carries its read position only as a valid sequence (ISSUE-606)', () => {
  const carried = (value?: string) => {
    const form = new FormData();
    if (value !== undefined) form.set('readThrough', value);
    return formReadThrough(form);
  };
  assert({
    given:
      'a sequence, none, zero, a negative, a fraction and an oversized number',
    should: 'read only the positive safe integer',
    actual: [
      carried('42'),
      carried(),
      carried('0'),
      carried('-3'),
      carried('1.5'),
      carried('99999999999999999'),
    ],
    expected: [42, null, null, null, null, null],
  });
});
