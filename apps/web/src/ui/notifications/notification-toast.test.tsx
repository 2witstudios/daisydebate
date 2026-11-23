import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
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
  const view = renderAccessible(
    h(NotificationToast, { row, dismiss: () => {} }),
  );
  const toast = view.within('article', 'Challenge');
  assert({
    given: 'a challenge',
    should:
      'name it by its kind, say the inbox’s words, lead where the row leads and offer a named dismiss',
    actual: {
      named: view.has('article', 'Challenge'),
      words: toast.textContent().includes(row.text),
      leads: toast.attribute('link', 'See challenge', 'href') === '/friends',
      dismiss: toast.has('button', 'Dismiss'),
    },
    expected: { named: true, words: true, leads: true, dismiss: true },
  });
});

test('UnreadBadge', () => {
  assert({
    given: 'none, four and twelve unread',
    should: 'draw nothing, then the count, then 9+, hidden from the reader',
    actual: [0, 4, 12].map((unread) => {
      const view = renderAccessible(h(UnreadBadge, { unread }));
      // The badge's span is out of the tree: its count is in the link's name.
      const outOfTree =
        view.count('generic', undefined, { hidden: true }) -
        view.count('generic');
      return [view.textContent(), outOfTree];
    }),
    expected: [
      ['', 0],
      ['4', 1],
      ['9+', 1],
    ],
  });
});
