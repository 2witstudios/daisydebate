import { maintainHumanBallotFixtures } from './support/human-ballot-maintenance';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { createHumanBallotRound } from './support/human-ballot-round';
import { roundViewSchema, isNamedSeat } from '@daisy/protocol';
import { origin } from './support/accounts';
import { expect, test } from './support/round-files';
import { openPage } from './support/fixtures';
test.use({ roundCommands: true });

for (const prepAction of ['Save the rest', 'Start AC'])
  test(`native ${prepAction} and enhanced Round controls retain canonical state on reload`, async ({
    roundFiles,
    browser,
  }) => {
    const { page, roundId } = roundFiles;
    const native = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: false,
      storageState: await page.context().storageState(),
    });
    try {
      const formPage = await openPage(native, 'native Round commands');
      const path = `/rounds/${roundId}/room`;
      const read = async () => {
        const response = await native.request.get(`/api/rounds/${roundId}`);
        expect(response.status()).toBe(200);
        return roundViewSchema.parse(await response.json());
      };
      await formPage.goto(path);
      await formPage
        .getByRole('button', { name: 'Start round', exact: true })
        .click();
      await expect(formPage).toHaveURL(path);
      expect((await read()).status).toBe('active');
      await formPage
        .getByRole('button', { name: 'Use prep', exact: true })
        .click();
      await expect(
        formPage.getByRole('button', { name: 'Save the rest', exact: true }),
      ).toBeVisible();
      expect((await read()).checkpoint?.active_prep?.side).toBe('affirmative');
      await formPage
        .getByRole('button', { name: prepAction, exact: true })
        .click();
      await expect(
        formPage.getByRole('button', { name: 'End speech', exact: true }),
      ).toBeEnabled();
      const speaking = await read();
      const stalePage = await openPage(native, 'stale native Round command');
      await stalePage.goto(path);
      await stalePage
        .getByRole('button', { name: 'End speech', exact: true })
        .click();
      expect(speaking.checkpoint?.active_prep).toBeNull();
      await formPage
        .getByRole('button', { name: 'End speech', exact: true })
        .click();
      await expect(
        formPage.getByRole('button', {
          name: 'Confirm end speech',
          exact: true,
        }),
      ).toBeVisible();
      expect((await read()).version).toBe(speaking.version);
      await formPage
        .getByRole('button', { name: 'Confirm end speech', exact: true })
        .click();
      expect((await read()).segments[0]?.endedAt).not.toBeNull();
      const beforeRefusal = await read();
      await stalePage
        .getByRole('button', { name: 'Confirm end speech', exact: true })
        .click();
      await expect(
        stalePage.getByText(
          'The round changed or that action is no longer legal. Review the current round and try again.',
          { exact: true },
        ),
      ).toBeVisible();
      expect((await read()).version).toBe(beforeRefusal.version);
      await stalePage.close();
      await expect(async () => {
        await formPage.reload();
        await expect(
          formPage.getByRole('button', { name: 'Interrupt', exact: true }),
        ).toBeEnabled();
      }).toPass({ timeout: 45000 });
      await formPage
        .getByRole('button', { name: 'Interrupt', exact: true })
        .click();
      const interrupted = await read();
      const human = interrupted.participants
        .filter(isNamedSeat)
        .find((p) => p.kind === 'human' && p.role === 'affirmative')!;
      expect(interrupted.checkpoint?.floor?.holder_participant_id).toBe(
        human.id,
      );
      await expect(
        page.getByRole('button', { name: 'End speech', exact: true }),
      ).toBeEnabled();
      await page
        .getByRole('button', { name: 'End speech', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Confirm end speech', exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Confirm end speech', exact: true })
        .click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Command accepted' }),
      ).toBeVisible();
      const yielded = await read();
      expect(yielded.version).toBeGreaterThan(interrupted.version);
      expect(yielded.checkpoint?.floor).toBeNull();
      await page.reload();
      expect((await read()).version).toBe(yielded.version);
      await formPage.reload();
      await formPage
        .getByRole('button', { name: 'Forfeit round', exact: true })
        .click();
      await formPage
        .getByRole('button', { name: 'Confirm forfeit round', exact: true })
        .click();
      await expect(formPage).toHaveURL(`/rounds/${roundId}`);
      const final = await read();
      expect(final.status).toBe('completed');
      expect(final.outcome).toBe('negative');
      expect(new URL(formPage.url()).search).toBe('');
    } finally {
      await native.close();
    }
  });

test('native attendance records an actual opened speech through the mounted production POST', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 4);
  const host = accounts.members[0]!;
  const native = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: false,
    storageState: await host.context.storageState(),
  });
  try {
    const round = await createHumanBallotRound(accounts.members);
    await maintainHumanBallotFixtures([round.id]);
    const page = await openPage(native, 'native actual attendance');
    await page.goto(`/rounds/${round.id}/room`);
    const button = page.getByRole('button', {
      name: 'Record attendance for this speech',
      exact: true,
    });
    await expect(button).toBeVisible();
    const form = page.locator('form', { has: button });
    await expect(form).toHaveAttribute(
      'action',
      `/api/rounds/${round.id}/check-in`,
    );
    expect(await form.locator('input[name="commandId"]').inputValue()).toMatch(
      /^[a-z0-9]{20,32}$/,
    );
    await button.click();
    await expect(
      page.getByRole('heading', { name: 'Attendance recorded', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('link', { name: 'Return to the round', exact: true })
      .click();
    await expect(page).toHaveURL(`/rounds/${round.id}/room`);
    await expect(
      page.getByText('Attendance recorded for Affirmative constructive.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: 'Record attendance for this speech',
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await native.close();
    await accounts.closeContexts();
  }
});
