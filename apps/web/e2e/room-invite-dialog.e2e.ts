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
/**
 * A changed invitation reaches a page through room sync. This suite runs
 * without realtime, so that is the next poll (5 s) and its read.
 */
const SYNCED = { timeout: 15_000 };

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
  test.setTimeout(120_000);
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

    // RID-2, RID-5: a refusal is read in the open dialog, the name and the
    // seat kind chosen are kept, and focus is back on the field.
    const judge = dialog.getByRole('radio', { name: 'Judge' });
    await judge.check();
    await inviteByKeyboard(page, 'nobody-by-this-name');
    await expect(dialog.getByRole('status')).toHaveText(
      'No member has that username.',
    );
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Username' })).toHaveValue(
      'nobody-by-this-name',
    );
    await expect(judge).toBeChecked();
    await expectFocusOn(page, 'input', USERNAME_FIELD);
    // The corrected name still goes out as a judge: this Room has no judge seat.
    await inviteByKeyboard(page, guest.username);
    await expect(dialog.getByRole('status')).toHaveText(
      'There is no free seat of that kind left to hold.',
    );
    await expect(judge).toBeChecked();

    // RID-2, RID-3, RID-5: sent; the notice and the pending entry show in
    // the dialog, the field empties for the next name, the button counts.
    await dialog.getByRole('radio', { name: 'Debater' }).check();
    await inviteByKeyboard(page, guest.username);
    await expect(
      dialog.getByText(
        `Invited @${guest.username}. Their seat is held for them.`,
      ),
    ).toBeVisible();
    await expect(pending.getByRole('listitem')).toHaveText(
      [new RegExp(`@${guest.username} · invited to debate`)],
      SYNCED,
    );
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Username' })).toHaveValue(
      '',
    );
    await expectFocusOn(page, 'input', USERNAME_FIELD);

    // Esc closes it; the count is on the button without opening it.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toHaveText('Invite people (1 pending)', SYNCED);
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

    // Decline by keyboard: the notice goes, focus lands on the Room title,
    // and the host's count goes.
    const decline = notice.getByRole('button', { name: 'Decline' });
    await hydrated(decline);
    await decline.focus();
    await guest.page.keyboard.press('Enter');
    await expectFocusOn(guest.page, 'h1', 'room-heading');
    await expect(notice).toHaveCount(0, SYNCED);
    await page.reload();
    await hydrated(opener);
    await expect(opener).toHaveText('Invite people');

    // Reopened, the dialog starts again: the earlier notice is not waiting.
    await opener.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('status')).toHaveCount(0);

    // RID-2, RID-5: invited again, then Withdraw in the same open dialog;
    // its answer hands focus to the field, then the entry and the count go.
    const withdraw = pending.getByRole('button', { name: 'Withdraw' });
    await inviteByKeyboard(page, guest.username);
    await expect(pending.getByRole('listitem')).toHaveCount(1, SYNCED);
    await withdraw.focus();
    await page.keyboard.press('Enter');
    await expectFocusOn(page, 'input', USERNAME_FIELD);
    await expect(pending).toHaveCount(0, SYNCED);
    await expect(dialog).toBeVisible();

    // RID-5: an invitation can end elsewhere just as the host withdraws it,
    // and the read that says so can land before the Withdraw answer. The
    // member declines; the host's next read is held back until Withdraw has
    // been pressed, so the row goes while its answer is still on the way.
    // Focus, lost with the button, is on the field in the still-open dialog.
    await inviteByKeyboard(page, guest.username);
    await expect(pending.getByRole('listitem')).toHaveCount(1, SYNCED);
    // Each step waits on the one before, whatever order the page sends in.
    const gate = () => {
      let open = () => {};
      const opened = new Promise<void>((resolve) => {
        open = resolve;
      });
      return { open, opened };
    };
    const declined = gate();
    const readTaken = gate();
    const withdrawPressed = gate();
    const rowGone = gate();
    const held = { armed: false, taken: false };
    await page.route(`**/rooms/${roomId}`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      if (route.request().postData()?.includes('withdraw')) {
        // The answer waits until the read has taken the row away.
        await rowGone.opened;
        return route.fallback();
      }
      if (!held.armed || held.taken) return route.fallback();
      held.taken = true;
      readTaken.open();
      // Read only once the member has declined, so it says the row is gone.
      await declined.opened;
      const response = await route.fetch();
      await withdrawPressed.opened;
      await route.fulfill({ response });
    });
    const invited = roomViewSchema.parse(
      await (await guest.context.request.get(`/api/rooms/${roomId}`)).json(),
    ).invitations[0];
    held.armed = true;
    await readTaken.opened;
    const declineAnswer = await guest.context.request.post(
      '/api/room-invitations/decline',
      { headers: { origin }, data: { version: 1, invitationId: invited?.id } },
    );
    expect(declineAnswer.ok()).toBe(true);
    declined.open();
    await withdraw.focus();
    await page.keyboard.press('Enter');
    await expect(withdraw).toBeDisabled();
    withdrawPressed.open();
    await expect(pending).toHaveCount(0);
    await expectFocusOn(page, 'input', USERNAME_FIELD);
    rowGone.open();
    await page.unroute(`**/rooms/${roomId}`);

    // Done closes it, and a notice from this opening is gone on the next.
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toHaveText('Invite people');
    await opener.click();
    await expect(dialog.getByRole('status')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // The withdrawn invitation is not on the invited member's page.
    await guest.page.reload();
    await expect(notice).toHaveCount(0);
  } finally {
    if (roomId) await closeRoom(host.context.request, roomId);
    await host.context.close();
    await guest.context.close();
  }
});
