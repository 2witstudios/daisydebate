import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { initialInvitationForm } from '../../../features/room-invitations/submit';
import { pendingInvitation } from '../../../features/rooms/assembly.test-support';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { InvitePeople } from './invite-people';

setupRitewayBun();

const action = async () => initialInvitationForm;
const pending = [
  pendingInvitation,
  {
    ...pendingInvitation,
    id: 'j'.repeat(24),
    invitee: 'rival',
    seat: 'side' as const,
  },
];
type Pending = (typeof pending)[number][];
const render = (invitations: Pending) =>
  renderAccessible(
    <InvitePeople
      invitations={invitations}
      action={action}
      competitor="side"
    />,
  );
/** The hidden fields a submit button posts with its form. */
const posted = (button: Element) =>
  Object.fromEntries(
    [
      ...((button as HTMLButtonElement).form?.querySelectorAll(
        'input[type="hidden"]',
      ) ?? []),
    ].map((input) => [
      (input as HTMLInputElement).name,
      (input as HTMLInputElement).value,
    ]),
  );
const hidden = { hidden: true } as const;

// Each render replaces the one before it in the helper's document, so a test
// reads one render before making the next.
// A closed dialog's aria-labelledby name is not computed (the heading is
// hidden with it), so the dialog is found by role and its label checked
// against the heading.
const dialogOf = (view: ReturnType<typeof render>) =>
  view.within('dialog', undefined, hidden);

describe('InvitePeople', () => {
  test('the button announces a dialog that starts closed', () => {
    const view = render(pending);
    assert({
      given: 'the server render',
      should:
        'offer Invite people as a button opening a dialog, closed and shown only while open',
      actual: [
        view.attribute('button', /^Invite people/, 'aria-haspopup'),
        view.has('dialog'),
        view.has('dialog', undefined, hidden),
      ],
      expected: ['dialog', false, true],
    });
  });

  test('the button carries the number of pending invitations', () => {
    assert({
      given: 'two pending invitations, then none',
      should: 'count them in the label, and show no count for none',
      // The label's text: the helper's name computation (happy-dom styles)
      // spaces the sr-only span off as if it were a block.
      actual: [
        render(pending).text('button', /^Invite people/),
        render([]).text('button', 'Invite people'),
      ],
      expected: ['Invite people (2 pending)', 'Invite people'],
    });
  });

  test('the dialog holds the whole invite tool', () => {
    const view = render(pending);
    const dialog = dialogOf(view);
    const username = dialog.get('textbox', 'Username', hidden);
    assert({
      given: 'the dialog markup',
      should:
        'name it by its heading, say how long a seat is held, and offer the username, the seat kind, Send invitation and Done',
      actual: [
        view.attribute('dialog', undefined, 'aria-labelledby', hidden) ===
          dialog.get('heading', 'Invite people', { level: 2, hidden: true }).id,
        dialog.textContent().includes('their seat is held for 24 hours'),
        posted(dialog.get('button', 'Send invitation', hidden)),
        username.getAttribute('name'),
        dialog.attribute('radio', 'Debater', 'value', {
          checked: true,
          hidden: true,
        }),
        dialog.attribute('radio', 'Judge', 'value', hidden),
        dialog.has('button', 'Done', hidden),
      ],
      expected: [
        true,
        true,
        { intent: 'invite' },
        'username',
        'side',
        'judge',
        true,
      ],
    });
  });

  test('each pending invitation is listed with Withdraw', () => {
    const list = dialogOf(render(pending)).within(
      'list',
      'Pending invitations',
      hidden,
    );
    const items = list
      .all('listitem', undefined, hidden)
      .map((item) =>
        item.firstElementChild?.textContent?.replace(/\s+/g, ' ').trim(),
      );
    const withdraws = list.all('button', 'Withdraw', hidden).map(posted);
    const none = render([]);
    assert({
      given: 'two pending invitations, then none',
      should:
        'list each with who and as what and its own Withdraw, and no list for none',
      actual: [
        items,
        withdraws,
        none.has('list', 'Pending invitations', hidden),
        none.count('button', 'Withdraw', hidden),
      ],
      expected: [
        ['@coach · invited to judge', '@rival · invited to debate'],
        [
          { intent: 'withdraw', invitationId: pendingInvitation.id },
          { intent: 'withdraw', invitationId: 'j'.repeat(24) },
        ],
        false,
        0,
      ],
    });
  });
});
