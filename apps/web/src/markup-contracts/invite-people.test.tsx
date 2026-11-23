import { assert, setupRitewayBun, test } from 'riteway/bun';
import { initialInvitationForm } from '../features/room-invitations/submit';
import { pendingInvitation } from '../features/rooms/assembly.test-support';
import { renderMarkup } from '../test-support/rendered/markup';
import { InvitePeople } from '../ui/rooms/room-page/invite-people';

setupRitewayBun();
const action = async () => initialInvitationForm;
const html = renderMarkup(
  <InvitePeople
    invitations={[
      pendingInvitation,
      { ...pendingInvitation, id: 'j'.repeat(24), invitee: 'rival' },
    ]}
    action={action}
    competitor="side"
  />,
);

// Markup contract: the closed dialog's display is carried only by its
// classes (open:flex), which have no accessible equivalent to assert.
test('the dialog is shown only while open', () => {
  assert({
    given: 'the server render',
    should:
      'display the dialog only while open, never as an unconditional flex',
    actual: [
      html.includes('open:flex'),
      /(?:^|\s)flex(?:\s|$)/.test(
        html.match(/<dialog[^>]*class="([^"]*)"/)?.[1] ?? '',
      ),
    ],
    expected: [true, false],
  });
});

// Markup contract: sighted members see the bare count because "pending" is
// visually hidden (sr-only); the accessible name reads the whole label.
test('the button shows sighted members the bare count', () => {
  assert({
    given: 'two pending invitations',
    should: 'show sighted members the bare count',
    actual: html.includes('(2<span class="sr-only"> pending</span>)'),
    expected: true,
  });
});
