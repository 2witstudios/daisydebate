import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { InboxRow } from './inbox-row';
setupRitewayBun();
const now = '2026-10-26T18:00:00.000Z';
const channelId = 'c'.repeat(24);
const entry = {
  channelId,
  kind: 'conversation' as const,
  title: 'kelvin',
  preview: { text: 'Good round', fromSelf: true },
  activityAt: '2026-10-26T17:15:00.000Z',
  unread: false,
};
const render = (value: Parameters<typeof InboxRow>[0]['entry']) =>
  renderToStaticMarkup(<InboxRow entry={value} now={now} />);
test('an inbox row names the other party, previews the newest message and shows its age', () => {
  const html = render(entry);
  assert({
    given: 'a read conversation whose newest message is your own',
    should: 'link the name to the conversation with a "You:" preview and age',
    actual: [
      html.includes(`href="/messages/${channelId}"`),
      html.includes('kelvin</a>'),
      html.includes('You: Good round'),
      html.includes('>45m</time>'),
      html.includes('unread'),
    ],
    expected: [true, true, true, true, false],
  });
  assert({
    given: 'an unread conversation',
    should: 'name its unread state in the link itself',
    actual: render({ ...entry, unread: true }).includes(
      'kelvin<span class="sr-only">, unread</span></a>',
    ),
    expected: true,
  });
});
test('requests and groups say what they are', () => {
  const incoming = render({
    ...entry,
    kind: 'incoming_request',
    preview: { text: 'Practice tonight?', fromSelf: false },
    unread: true,
  });
  assert({
    given: 'an incoming request',
    should: 'name the sender for screen readers and open the request',
    actual: [
      incoming.includes(
        '<span class="sr-only">Message request from </span>kelvin',
      ),
      incoming.includes(`href="/messages/requests/${channelId}"`),
      incoming.includes('Practice tonight?'),
    ],
    expected: [true, true, true],
  });
  const sent = render({ ...entry, kind: 'outgoing_request', preview: null });
  assert({
    given: 'a sent request without an introduction',
    should: 'open its status and say it awaits a reply',
    actual: [
      sent.includes(`href="/messages/requests/${channelId}/status"`),
      sent.includes('Waiting for a reply.'),
    ],
    expected: [true, true],
  });
  const group = render({
    ...entry,
    kind: 'group_conversation',
    title: null,
    preview: null,
  });
  assert({
    given: 'a group whose title was erased and has no messages',
    should: 'fall back to a neutral name and link its membership',
    actual: [
      group.includes('Untitled group'),
      group.includes('No messages yet.'),
      group.includes(`href="/messages/groups/${channelId}/manage"`),
    ],
    expected: [true, true, true],
  });
  assert({
    given: 'a conversation whose counterpart erased their account',
    should: 'never invent a name',
    actual: render({ ...entry, title: null }).includes('Deleted account'),
    expected: true,
  });
});
test('a group invitation reveals nothing about the group', () => {
  const html = render({ channelId, kind: 'incoming_invitation' });
  assert({
    given: 'a pending invitation',
    should: 'link only to the invitation decision',
    actual: [
      html.includes(`href="/messages/groups/invitations/${channelId}"`),
      html.includes('Group invitation</a>'),
    ],
    expected: [true, true],
  });
});
