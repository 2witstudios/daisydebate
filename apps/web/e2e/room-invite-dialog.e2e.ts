import type { Browser, Page } from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import { roomViewSchema } from '@daisy/protocol';
import { expect, openPage, test } from './support/fixtures';
import { origin, resetRateLimits, signUpMember } from './support/accounts';
import { expectFocusOn } from './support/focus';
import { hydrated } from './support/hydration';
import {
  foundationChoice,
  humanRoundSelection,
} from './support/human-round-selection';
import { closeRoom } from './support/room-launch-flow';

// RID-1 to RID-5: the host's Invite people tool is a header button and a
// modal dialog on the pre-round Room, and the invited member's notice stays
// on the page. A dialog and its focus only exist in a browser.
const USERNAME_FIELD = 'invite-people-username';

const member = async (browser: Browser, purpose: string) => {
  const context = await browser.newContext({ baseURL: origin });
  const { username } = await signUpMember(context.request);
  return { context, username, page: await openPage(context, purpose) };
};

/** Types a name into the open dialog and sends it with Enter alone. */
const inviteByKeyboard = async (page: Page, username: string) => {
  const field = page.getByRole('textbox', { name: 'Username' });
  await field.focus();
  await field.fill(username);
  await page.keyboard.press('Enter');
};

test('the host invites from a header dialog that stays open, and the invited member is told on the page', async ({
  browser,
  request,
}) => {
  test.setTimeout(90_000);
  await resetRateLimits(request);
  const host = await member(browser, 'the host’s Room');
  const guest = await member(browser, 'the invited member’s Room');
  let roomId: string | undefined;
  try {
    const created = await host.context.request.post('/api/rooms', {
      headers: { origin },
      data: {
        commandId: createId(),
        title: 'Invite dialog room',
        resolution: { kind: 'custom', text: 'Cities should fund transit' },
        visibility: 'public',
        // No judge seat: an invitation to judge has no seat to hold.
        selection: humanRoundSelection(foundationChoice, 0),
      },
    });
    expect(created.status()).toBe(201);
    roomId = roomViewSchema.parse((await created.json()).view).id;

    const page = host.page;
    await page.goto(`/rooms/${roomId}`);
    const opener = page.getByRole('button', { name: /^Invite people/ });
    const dialog = page.getByRole('dialog', { name: 'Invite people' });
    const pending = dialog.getByRole('list', { name: 'Pending invitations' });
    await hydrated(opener);

    // RID-1: no card on the page; the tool is behind the header button.
    await expect(opener).toHaveText('Invite people');
    await expect(page.locator('header').getByRole('button')).toContainText([
      'Copy invite link',
      'Invite people',
    ]);
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Send invitation')).toBeHidden();
    await opener.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('their seat is held for 24 hours');

    // RID-2, RID-5: a refusal is read in the open dialog, the name is kept,
    // and focus is back on the field.
    await inviteByKeyboard(page, 'nobody-by-this-name');
    await expect(dialog.getByRole('status')).toHaveText(
      'No member has that username.',
    );
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Username' })).toHaveValue(
      'nobody-by-this-name',
    );
    await expectFocusOn(page, 'input', USERNAME_FIELD);
    await dialog.getByRole('radio', { name: 'Judge' }).check();
    await inviteByKeyboard(page, guest.username);
    await expect(dialog.getByRole('status')).toHaveText(
      'There is no free seat of that kind left to hold.',
    );

    // RID-2, RID-3, RID-5: sent; the notice and the pending entry show in
    // the dialog, the field empties for the next name, the button counts.
    await dialog.getByRole('radio', { name: 'Debater' }).check();
    await inviteByKeyboard(page, guest.username);
    await expect(
      dialog.getByText(
        `Invited @${guest.username}. Their seat is held for them.`,
      ),
    ).toBeVisible();
    await expect(pending.getByRole('listitem')).toHaveText([
      new RegExp(`@${guest.username} · invited to debate`),
    ]);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Username' })).toHaveValue(
      '',
    );
    await expectFocusOn(page, 'input', USERNAME_FIELD);

    // Esc closes it; the count is on the button without opening it.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toHaveText('Invite people (1 pending)');
    await expect(opener).toBeFocused();

    // RID-4: the invited member is told on the page itself, with Decline
    // and no host tool.
    await guest.page.goto(`/rooms/${roomId}`);
    const notice = guest.page.getByRole('region', { name: 'You’re invited' });
    await expect(notice).toContainText(
      `@${host.username} invited you to debate. A debater seat below is held for you.`,
    );
    await expect(notice.getByRole('button', { name: 'Decline' })).toBeVisible();
    await expect(
      guest.page.getByRole('button', { name: /^Invite people/ }),
    ).toHaveCount(0);

    // RID-2, RID-5: Withdraw from the reopened dialog; the entry and the
    // count go, focus returns to the field, and Done closes it.
    await opener.click();
    const withdraw = pending.getByRole('button', { name: 'Withdraw' });
    await withdraw.focus();
    await page.keyboard.press('Enter');
    await expect(pending).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expectFocusOn(page, 'input', USERNAME_FIELD);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toHaveText('Invite people');

    // The withdrawn invitation leaves the invited member's page.
    await guest.page.reload();
    await expect(notice).toHaveCount(0);
  } finally {
    if (roomId) await closeRoom(host.context.request, roomId);
    await host.context.close();
    await guest.context.close();
  }
});
