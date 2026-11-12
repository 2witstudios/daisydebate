import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { initialInvitationForm } from '../../../features/room-invitations/submit';
import { pendingInvitation } from '../../../features/rooms/assembly.test-support';
import { InvitePeople } from './invite-people';

setupRitewayBun();

const action = async () => initialInvitationForm;
const pending = [
  pendingInvitation,
  {
    ...pendingInvitation,
    id: 'j'.repeat(24),
    invitee: 'rival',
    seat: 'debater' as const,
  },
];
type Pending = (typeof pending)[number][];
const render = (invitations: Pending) =>
  renderToStaticMarkup(
    <InvitePeople invitations={invitations} action={action} />,
  );
const openerLabel = (html: string) =>
  html
    .match(/<button[^>]*aria-haspopup="dialog"[^>]*>(.*?)<\/button>/)?.[1]
    ?.replace(/<[^>]+>/g, '');

describe('InvitePeople', () => {
  const html = render(pending);
  const none = render([]);

  test('the button announces a dialog that starts closed', () => {
    assert({
      given: 'the server render',
      should:
        'offer Invite people as a button opening a dialog, closed and shown only while open',
      actual: [
        openerLabel(html)?.startsWith('Invite people'),
        /<dialog[^>]*\sopen(=|\s|>)/.test(html),
        html.includes('open:flex'),
        /(?:^|\s)flex(?:\s|$)/.test(
          html.match(/<dialog[^>]*class="([^"]*)"/)?.[1] ?? '',
        ),
      ],
      expected: [true, false, true, false],
    });
  });

  test('the button carries the number of pending invitations', () => {
    assert({
      given: 'two pending invitations, then none',
      should: 'count them in the label, and show no count for none',
      actual: [openerLabel(html), openerLabel(none)],
      expected: ['Invite people (2 pending)', 'Invite people'],
    });
    assert({
      given: 'two pending invitations',
      should: 'show sighted members the bare count',
      actual: html.includes('(2<span class="sr-only"> pending</span>)'),
      expected: true,
    });
  });

  test('the dialog holds the whole invite tool', () => {
    assert({
      given: 'the dialog markup',
      should:
        'name it by its heading, say how long a seat is held, and offer the username, the seat kind, Send invitation and Done',
      actual: [
        html.includes('aria-labelledby="invite-people-title"'),
        /<h2 id="invite-people-title"[^>]*>Invite people<\/h2>/.test(html),
        html.includes('their seat is held for 24 hours'),
        html.includes('name="intent" value="invite"'),
        html.includes('name="username"'),
        /<input(?=[^>]*value="debater")(?=[^>]*checked)[^>]*>/.test(html),
        html.includes('name="seat" value="judge"'),
        html.includes('>Send invitation</button>'),
        html.includes('>Done</button>'),
      ],
      expected: [true, true, true, true, true, true, true, true, true],
    });
  });

  test('each pending invitation is listed with Withdraw', () => {
    assert({
      given: 'two pending invitations, then none',
      should:
        'list each with who and as what and its own Withdraw, and no list for none',
      actual: [
        html.includes('aria-label="Pending invitations"'),
        html.includes('@coach · invited to judge'),
        html.includes('@rival · invited to debate'),
        html.split('name="intent" value="withdraw"').length - 1,
        html.includes(`name="invitationId" value="${'j'.repeat(24)}"`),
        none.includes('Pending invitations'),
        none.includes('Withdraw'),
      ],
      expected: [true, true, true, 2, true, false, false],
    });
  });
});
