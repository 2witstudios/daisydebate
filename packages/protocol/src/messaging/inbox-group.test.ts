import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingInboxSchemas, messagingInboxPreviewMax } from './inbox';
setupRitewayBun();
test('authorized group conversation navigation remains distinct from invitation or DM grants', () => {
  const result = createMessagingInboxSchemas(3).result.safeParse({
    version: 1,
    entries: [
      {
        channelId: 'c'.repeat(24),
        kind: 'group_conversation',
        title: 'Policy club',
        preview: { text: 'Round at six', fromSelf: false },
        activityAt: '2026-10-26T18:00:00.000Z',
        unread: true,
      },
    ],
    nextAfter: null,
  });
  assert({
    given: 'separately authorized private-group conversation',
    should:
      'retain its kind for membership navigation with its title and excerpt',
    actual: result.success,
    expected: true,
  });
});
test('an inbox excerpt is bounded and never the full message', () => {
  const entry = {
    channelId: 'c'.repeat(24),
    kind: 'conversation',
    title: 'kelvin',
    activityAt: '2026-10-26T18:00:00.000Z',
    unread: false,
  };
  const parse = (text: string) =>
    createMessagingInboxSchemas(3).result.safeParse({
      version: 1,
      entries: [{ ...entry, preview: { text, fromSelf: true } }],
      nextAfter: null,
    }).success;
  assert({
    given: 'excerpts at and beyond the preview bound',
    should: 'admit the bound and refuse anything longer',
    actual: [
      parse('x'.repeat(messagingInboxPreviewMax)),
      parse('x'.repeat(messagingInboxPreviewMax + 1)),
    ],
    expected: [true, false],
  });
});
