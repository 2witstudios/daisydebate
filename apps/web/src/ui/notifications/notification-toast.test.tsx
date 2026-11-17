import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { UnreadBadge } from '../layout/app-shell/components/rail/notifications-link';
import { NotificationToast } from './notification-toast';

setupRitewayBun();

const row = {
  id: 'c1',
  kind: 'challenge_received' as const,
  text: '@devon_k challenged you to a casual Freestyle debate.',
  href: '/friends',
  surfacedAt: '2026-11-16T12:00:00.000Z',
};

test('NotificationToast', () => {
  const html = renderToStaticMarkup(
    h(NotificationToast, { row, dismiss: () => {} }),
  );
  assert({
    given: 'a challenge',
    should:
      'name it by its kind, say the inbox’s words, lead where the row leads and offer a named dismiss',
    actual: {
      named: html.includes('aria-label="Challenge"'),
      words: html.includes(row.text),
      leads: html.includes('href="/friends"'),
      dismiss: html.includes('aria-label="Dismiss"'),
    },
    expected: { named: true, words: true, leads: true, dismiss: true },
  });
});

test('UnreadBadge', () => {
  assert({
    given: 'none, four and twelve unread',
    should: 'draw nothing, then the count, then 9+, hidden from the reader',
    actual: [0, 4, 12].map((unread) =>
      renderToStaticMarkup(h(UnreadBadge, { unread })).replace(/<[^>]*>/g, ''),
    ),
    expected: ['', '4', '9+'],
  });
});
