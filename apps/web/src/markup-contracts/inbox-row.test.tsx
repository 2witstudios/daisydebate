import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { InboxRow } from '../ui/messaging/inbox-row';

setupRitewayBun();

const entry = {
  channelId: 'c'.repeat(24),
  kind: 'conversation' as const,
  title: 'kelvin',
  preview: { text: 'Good round', fromSelf: true },
  activityAt: '2026-10-26T17:15:00.000Z',
  unread: false,
};
const now = '2026-10-26T18:00:00.000Z';

/**
 * The open row's fill is a design-system surface with no ARIA equivalent;
 * its current state is read by role in ui/messaging/inbox-row.test.tsx.
 */
test('the open conversation row is filled', () => {
  assert({
    given: 'the row of the open conversation, then a plain row',
    should: 'fill only the open one',
    actual: [
      renderMarkup(
        h(InboxRow, { entry, now, current: true, inert: true }),
      ).includes('bg-accent-soft'),
      renderMarkup(h(InboxRow, { entry, now })).includes('bg-accent-soft'),
    ],
    expected: [true, false],
  });
});
