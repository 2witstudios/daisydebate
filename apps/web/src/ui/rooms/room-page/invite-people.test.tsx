import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { initialInvitationForm } from '../../../features/room-invitations/submit';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import { InvitePeople } from './invite-people';
import type * as Client from './invite-people.test-support';

setupRitewayBun();

const action = async () => initialInvitationForm;
const invitation = (
  id: string,
  invitee: string,
  seat: 'debater' | 'judge',
) => ({
  id: id.repeat(24),
  seat,
  invitee,
  inviter: 'host',
  expiresAt: '2026-11-11T12:00:00.000Z',
});
const pending = [
  invitation('i', 'coach', 'judge'),
  invitation('j', 'rival', 'debater'),
];
const render = (invitations: typeof pending) =>
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

  test('an answer hands focus to the username field', () => {
    assert({
      given: 'the dialog markup',
      should: 'give the username field the id focus returns to',
      actual:
        /<input(?=[^>]*id="invite-people-username")(?=[^>]*name="username")/.test(
          html,
        ),
      expected: true,
    });
  });
});

test('a withdrawn invitation that leaves before its answer hands focus to the username field', async () => {
  const mount = async () => {
    const client = await mountBrowserClient<typeof Client>(
      Bun.resolveSync('./invite-people.test-support', import.meta.dir),
    );
    const show = (invitations: typeof pending) =>
      client.act(() =>
        client.root.render(
          client.createElement(client.InvitePeople, { invitations, action }),
        ),
      );
    const focused = () => {
      const active = client.browser.document.activeElement;
      return active?.id || active?.textContent || active?.tagName;
    };
    const button = (label: string) =>
      [...client.container.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === label,
      );
    return { ...client, show, focused, button };
  };

  const onWithdraw = await mount();
  await onWithdraw.show([pending[0]!]);
  onWithdraw.button('Withdraw')?.focus();
  const before = onWithdraw.focused();
  // Room sync says the invitation ended: its row, and the focused button, go.
  await onWithdraw.show([]);

  const elsewhere = await mount();
  await elsewhere.show([pending[0]!]);
  elsewhere.button('Done')?.focus();
  await elsewhere.show([]);

  assert({
    given:
      'focus on a Withdraw button whose row room sync removes, then focus on Done when a row is removed',
    should:
      'move focus to the username field only when it fell off the page, never away from where the host put it',
    actual: [before, onWithdraw.focused(), elsewhere.focused()],
    expected: ['Withdraw', 'invite-people-username', 'Done'],
  });
  await onWithdraw.act(() => onWithdraw.root.unmount());
  await elsewhere.act(() => elsewhere.root.unmount());
});
