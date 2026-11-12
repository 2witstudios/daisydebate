import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  FormData as BrowserFormData,
  type HTMLButtonElement as BrowserButton,
  type HTMLDialogElement as BrowserDialog,
} from 'happy-dom';
import {
  initialInvitationForm,
  type InvitationFormState,
} from '../../../features/room-invitations/submit';
import { pendingInvitation } from '../../../features/rooms/assembly.test-support';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import { InvitePeople } from './invite-people';
import type * as Client from './invite-people.test-support';

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

/** The dialog open in a real React tree, with answers the test releases by hand. */
async function openDialog(invitations: Pending) {
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./invite-people.test-support', import.meta.dir),
    // What React's form posting reads from the realm.
    { FormData: BrowserFormData, performance },
  );
  const answers: ((answer: InvitationFormState) => void)[] = [];
  const held = () =>
    new Promise<InvitationFormState>((resolve) => answers.push(resolve));
  const show = (next: Pending) =>
    client.act(async () =>
      client.root.render(
        client.createElement(client.InvitePeople, {
          invitations: next,
          action: held,
        }),
      ),
    );
  await show(invitations);
  const dialog = client.container.querySelector(
    'dialog',
  ) as unknown as BrowserDialog;
  dialog.showModal();
  const buttons = (label: string) =>
    [...client.container.querySelectorAll('button')].filter(
      (candidate) => candidate.textContent === label,
    ) as unknown as BrowserButton[];
  const press = (button: BrowserButton | undefined) =>
    client.act(async () => {
      button?.focus();
      button?.click();
    });
  const answer = (index: number, state: InvitationFormState) =>
    client.act(async () => answers[index]?.(state));
  const focus = () => {
    const active = client.browser.document.activeElement;
    return active?.id || active?.tagName;
  };
  /** Focus on `<body>`; happy-dom will not blur a disabled button itself. */
  const dropFocus = () => {
    buttons('Done')[0]?.focus();
    buttons('Done')[0]?.blur();
  };
  const close = () => client.act(async () => client.root.unmount());
  return {
    ...client,
    dialog,
    show,
    buttons,
    press,
    answer,
    focus,
    dropFocus,
    close,
  };
}
const withdrawn: InvitationFormState = {
  kind: 'accepted',
  notice: 'Invitation withdrawn.',
};

test('a Withdraw whose row room sync removes before its answer hands focus to the username field', async () => {
  const page = await openDialog([pending[0]!]);
  await page.press(page.buttons('Withdraw')[0]);
  const disabled = page.buttons('Withdraw')[0]?.disabled;
  await page.show([]);
  assert({
    given:
      'the open dialog, a Withdraw pressed by keyboard and still unanswered, then its row removed',
    should:
      'disable the button while it waits, then put focus on the username field',
    actual: [page.dialog.open, disabled, page.focus()],
    expected: [true, true, 'invite-people-username'],
  });
  await page.close();
});

test('a Withdraw answer hands focus to the username field only when focus is lost', async () => {
  const lost = await openDialog(pending);
  await lost.press(lost.buttons('Withdraw')[0]);
  // A browser drops focus from a control as it is disabled; happy-dom does not.
  lost.dropFocus();
  await lost.answer(0, withdrawn);

  const movedOn = await openDialog(pending);
  await movedOn.press(movedOn.buttons('Withdraw')[0]);
  movedOn.buttons('Done')[0]?.focus();
  await movedOn.answer(0, withdrawn);
  const onDone =
    movedOn.browser.document.activeElement ===
    (movedOn.buttons('Done')[0] as unknown);

  assert({
    given:
      'a Withdraw answered after its disabled button dropped focus, then one answered after the host moved to Done',
    should:
      'move focus to the username field the first time, and leave it on Done the second',
    actual: [lost.focus(), onDone],
    expected: ['invite-people-username', true],
  });
  await lost.close();
  await movedOn.close();
});

test('an invitation that ends elsewhere moves no focus', async () => {
  const page = await openDialog(pending);
  page.dropFocus();
  const before = page.focus();
  await page.show([pending[1]!]);
  assert({
    given:
      'the open dialog with focus on the page body and nothing pending, then a row removed by room sync',
    should: 'leave focus where it was',
    actual: [before, page.focus()],
    expected: ['BODY', 'BODY'],
  });
  await page.close();
});

test('the dialog starts again each time it closes', async () => {
  const page = await openDialog([]);
  const field = () =>
    page.container.querySelector('input[name="username"]') as unknown as {
      value: string;
    };
  field().value = 'nobody';
  await page.press(page.buttons('Send invitation')[0]);
  await page.answer(0, {
    kind: 'refused',
    values: { username: 'nobody', seat: 'judge' },
    error: 'No member has that username.',
  });
  const refused = {
    notice: page.container.querySelector('[role="status"]')?.textContent,
    username: field().value,
    judge: page.container
      .querySelector('input[value="judge"]')
      ?.hasAttribute('checked'),
  };
  await page.act(async () => page.dialog.close());
  assert({
    given: 'a refused invite to judge, then the dialog closed',
    should:
      'keep the refusal, the name and the Judge choice while open, and reopen with an empty form and no notice',
    actual: [
      refused,
      page.container.querySelector('[role="status"]'),
      field().value,
    ],
    expected: [
      {
        notice: 'No member has that username.',
        username: 'nobody',
        judge: true,
      },
      null,
      '',
    ],
  });
  await page.close();
});
