import { renderAccessible } from '../../test-support/rendered/accessible';
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
  renderAccessible(<InboxRow entry={value} now={now} />);
test('an inbox row names the other party, previews the newest message and shows its age', () => {
  const view = render(entry);
  assert({
    given: 'a read conversation whose newest message is your own',
    should: 'link the name to the conversation with a "You:" preview and age',
    actual: [
      view.attribute('link', 'kelvin', 'href'),
      view.text('link', 'kelvin'),
      view.textContent().includes('You: Good round'),
      view.text('time'),
      view.textContent().includes('unread'),
    ],
    expected: [`/messages/${channelId}`, 'kelvin', true, '45m', false],
  });
  assert({
    given: 'an unread conversation',
    should: 'name its unread state in the link itself',
    actual: render({ ...entry, unread: true }).attribute(
      'link',
      'kelvin, unread',
      'href',
    ),
    expected: `/messages/${channelId}`,
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
      incoming.attribute('link', 'Message request from kelvin, unread', 'href'),
      incoming.textContent().includes('Practice tonight?'),
    ],
    expected: [`/messages/requests/${channelId}`, true],
  });
  const sent = render({ ...entry, kind: 'outgoing_request', preview: null });
  assert({
    given: 'a sent request without an introduction',
    should: 'open its status and say it awaits a reply',
    actual: [
      sent.attribute('link', 'Sent request to kelvin', 'href'),
      sent.textContent().includes('Waiting for a reply.'),
    ],
    expected: [`/messages/requests/${channelId}/status`, true],
  });
  const group = render({
    ...entry,
    kind: 'group_conversation',
    title: null,
    preview: null,
  });
  assert({
    given: 'a group whose title was erased and has no messages',
    should:
      'fall back to a neutral name, leaving membership to the conversation',
    actual: [
      group.attribute('link', 'Group Untitled group', 'href'),
      group.textContent().includes('No messages yet.'),
      group
        .all('link')
        .map((link) => link.getAttribute('href'))
        .some((href) => href?.includes('/manage')),
    ],
    expected: [`/messages/${channelId}`, true, false],
  });
  assert({
    given: 'a conversation whose counterpart erased their account',
    should: 'never invent a name',
    actual: render({ ...entry, title: null }).text('link', 'Deleted account'),
    expected: 'Deleted account',
  });
});
test('the open conversation says so and goes nowhere new', () => {
  const open = renderAccessible(
    <InboxRow entry={entry} now={now} current inert />,
  );
  assert({
    given: 'the row of the open conversation',
    should: 'mark it current, while other rows stay plain',
    actual: [
      open.has('link', 'kelvin', { current: 'page' }),
      render(entry).has('link', 'kelvin', { current: false }),
    ],
    expected: [true, true],
  });
});
test('a group invitation reveals nothing about the group', () => {
  const view = render({ channelId, kind: 'incoming_invitation' });
  assert({
    given: 'a pending invitation',
    should: 'link only to the invitation decision',
    actual: [
      view.all('link').map((link) => link.getAttribute('href')),
      view.names('link'),
    ],
    expected: [
      [`/messages/groups/invitations/${channelId}`],
      ['Group invitation'],
    ],
  });
});
