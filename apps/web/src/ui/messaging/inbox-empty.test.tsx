import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { InboxEmpty } from './inbox-empty';

setupRitewayBun();

test('an empty inbox offers one clear way to start a conversation', () => {
  const html = renderToStaticMarkup(<InboxEmpty />);
  assert({
    given: 'an inbox with no conversations',
    should: 'title the state and link the one action that fills it',
    actual: [
      html.includes('No messages yet</h2>'),
      html.includes('href="/messages/new"'),
      html.includes('>New message</a>'),
    ],
    expected: [true, true, true],
  });
});
