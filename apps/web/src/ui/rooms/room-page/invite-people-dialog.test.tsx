import {
  FormData as BrowserFormData,
  type HTMLButtonElement as BrowserButton,
  type HTMLDialogElement as BrowserDialog,
} from 'happy-dom';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { InvitationFormState } from '../../../features/room-invitations/submit';
import { pendingInvitation } from '../../../features/rooms/assembly.test-support';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import type * as Client from './invite-people.test-support';

setupRitewayBun();

// The open dialog in real React: where focus is after an answer, and what a
// reopened dialog shows. Static markup is in invite-people.test.tsx.
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

/** The dialog open in a real React tree, with answers the test releases by hand. */
async function mountDialog(invitations: Pending) {
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
  const close = async () => {
    await client.act(async () => client.root.unmount());
    await client.browser.happyDOM.close();
  };
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
/** A test over open dialogs, each unmounted and its window closed however the test ends. */
const dialogTest = (
  name: string,
  proof: (openDialog: typeof mountDialog) => Promise<void>,
) =>
  test(name, async () => {
    const opened: Awaited<ReturnType<typeof mountDialog>>[] = [];
    try {
      await proof(async (invitations) => {
        const page = await mountDialog(invitations);
        opened.push(page);
        return page;
      });
    } finally {
      for (const page of opened) await page.close();
    }
  });
const withdrawn: InvitationFormState = {
  kind: 'accepted',
  notice: 'Invitation withdrawn.',
};

dialogTest(
  'a Withdraw whose row room sync removes before its answer hands focus to the username field',
  async (openDialog) => {
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
  },
);

dialogTest(
  'a Withdraw answer hands focus to the username field only when focus is lost',
  async (openDialog) => {
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
  },
);

dialogTest(
  'a Withdraw whose button kept focus hands it to the username field when its row goes',
  async (openDialog) => {
    // happy-dom, like some engines, leaves focus on a control as it is disabled.
    const page = await openDialog([pending[0]!]);
    await page.press(page.buttons('Withdraw')[0]);
    await page.answer(0, withdrawn);
    const afterAnswer =
      page.browser.document.activeElement ===
      (page.buttons('Withdraw')[0] as unknown);
    await page.show([]);
    assert({
      given:
        'a Withdraw answered while focus never left its button, then its row removed by room sync',
      should:
        'leave focus on the button at the answer, and move it to the username field when the row goes',
      actual: [afterAnswer, page.focus()],
      expected: [true, 'invite-people-username'],
    });
  },
);

dialogTest(
  'an invitation that ends elsewhere moves no focus',
  async (openDialog) => {
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
  },
);

dialogTest(
  'the dialog starts again each time it closes',
  async (openDialog) => {
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
  },
);
