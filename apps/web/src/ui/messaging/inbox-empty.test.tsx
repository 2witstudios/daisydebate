import { renderAccessible } from '../../test-support/rendered/accessible';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { InboxEmpty } from './inbox-empty';

setupRitewayBun();

test('nothing open prompts for a conversation', () => {
  assert({
    given: 'conversations in the list and none open',
    should: 'prompt for one',
    actual: renderAccessible(<InboxEmpty hasConversations />).has(
      'heading',
      'Pick a conversation',
      { level: 2 },
    ),
    expected: true,
  });
});

test('an empty inbox offers one clear way to start a conversation', () => {
  const view = renderAccessible(<InboxEmpty hasConversations={false} />);
  assert({
    given: 'an inbox with no conversations',
    should: 'title the state and link the one action that fills it',
    actual: [
      view.has('heading', 'No messages yet', { level: 2 }),
      view.attribute('link', 'New message', 'href'),
      view.count('link'),
    ],
    expected: [true, '/messages/new', 1],
  });
});
