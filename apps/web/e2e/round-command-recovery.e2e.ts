import type { Locator } from '@playwright/test';
import { openPage } from './support/fixtures';
import { test, expect } from './support/live-room-documents';
import { controlLaunch } from './support/room-launch-settled';
import { roundViewSchema } from '@daisy/protocol/round-view';
test.use({ roundCommands: true });

/**
 * The command a form would post. React adds its own $ACTION fields only to a
 * server-rendered form, so a press that lands before hydration renders the
 * confirmation with them and the client-rendered retry without them.
 */
const commandFields = async (submit: Locator) =>
  Object.fromEntries(
    (
      await submit
        .locator('..')
        .locator('input[name]')
        .evaluateAll((inputs) =>
          inputs.map((input) => [
            (input as HTMLInputElement).name,
            (input as HTMLInputElement).value,
          ]),
        )
    ).filter(([name]) => !name!.startsWith('$ACTION')),
  );

for (const command of ['yield', 'forfeit'] as const)
  test(`unknown accepted ${command} keeps its exact reachable retry across fresh canonical state`, async ({
    liveRoom,
  }) => {
    const { page, roundId } = liveRoom;
    for (const name of ['Take prep time', 'Start affirmative constructive'])
      await page.getByRole('button', { name, exact: true }).click();
    const read = async () => {
      const response = await page.request.get(`/api/rounds/${roundId}`);
      expect(response.status()).toBe(200);
      return roundViewSchema.parse(await response.json());
    };
    // A post at a version the server has passed is refused, and this proves a post the
    // server accepted. The floor's own moves settle just after a speech opens.
    await expect(async () => {
      const { version } = await read();
      await page.waitForTimeout(1_500);
      expect((await read()).version).toBe(version);
    }).toPass();
    const label = command === 'yield' ? 'End speech' : 'Forfeit round';
    await page.getByRole('button', { name: label, exact: true }).click();
    const confirm = page.getByRole('button', {
      name: `Confirm ${label.toLowerCase()}`,
      exact: true,
    });
    await expect(confirm).toBeVisible();
    // The form posts the version it rendered, which can lag the read above.
    const { version } = await read();
    await expect
      .poll(async () => (await commandFields(confirm)).expectedVersion)
      .toBe(String(version));
    const original = await commandFields(confirm);
    let committed = false;
    let postedVersion: string | undefined;
    await page.route(`**/rounds/${roundId}/room`, async (route) => {
      // Only this command's own post loses its acknowledgement: the room's
      // other server actions (an attendance read after a refused check-in)
      // may post first and must pass through.
      if (
        !committed &&
        route.request().method() === 'POST' &&
        route.request().headers()['next-action'] &&
        route.request().postData()?.includes(original.commandId!)
      ) {
        // The live view may move the version before the post; the retry repeats the post.
        postedVersion = /name="[^"]*expectedVersion"\s+(\d+)/.exec(
          route.request().postData() ?? '',
        )?.[1];
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        committed = true;
        await route.fulfill({
          status: 503,
          contentType: 'text/plain',
          body: 'Lost command acknowledgement',
        });
      } else await route.continue();
    });
    await confirm.click();
    await expect
      .poll(async () =>
        command === 'yield'
          ? (await read()).segments[0]?.endedAt
          : (await read()).status,
      )
      .toEqual(command === 'yield' ? expect.any(String) : 'completed');
    await expect(
      page
        .getByText(
          'The command is not acknowledged. Review the current round before trying again.',
          { exact: true },
        )
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: label, exact: true }),
    ).toHaveCount(0);
    const retry = page
      .locator('form')
      .filter({
        has: page.locator(
          `input[name=commandId][value="${original.commandId}"]`,
        ),
      })
      .getByRole('button');
    await expect(retry).toBeEnabled({ timeout: 3000 });
    await expect(
      page
        .getByRole('alert')
        .filter({
          hasText:
            'The command is not acknowledged. Review the current round before trying again.',
        })
        .locator('..'),
    ).toBeFocused();
    expect(postedVersion).toBeDefined();
    expect(await commandFields(retry)).toEqual({
      ...original,
      expectedVersion: postedVersion,
    });
    const beforeRetry = await read();
    await retry.click();
    if (command === 'yield')
      await expect(
        page.getByRole('status').filter({ hasText: 'Done.' }),
      ).toBeVisible();
    else await expect(page).toHaveURL(`/rounds/${roundId}`);
    expect((await read()).version).toBe(beforeRetry.version);
    expect(committed).toBe(true);
  });

test('a capacity refusal on a mid-speech reload recovers on its own, End speech included (ISSUE-927)', async ({
  liveRoom,
}) => {
  test.setTimeout(240_000);
  const { page, roundId } = liveRoom;
  const path = `/rounds/${roundId}/room`;
  for (const name of ['Take prep time', 'Start affirmative constructive'])
    await page.getByRole('button', { name, exact: true }).click();
  const endSpeech = (seat: typeof page) =>
    seat.getByRole('button', { name: 'End speech', exact: true });
  await expect(endSpeech(page)).toBeEnabled();
  const receipt = await openPage(page.context(), 'refused receipt');
  try {
    for (const read of ['round', 'identity'] as const) {
      await controlLaunch(`refuse-${read}-reads`);
      try {
        const answer = await page.reload();
        // A Next page cannot choose a 5xx; it can stay uncacheable.
        expect(answer?.headers()['cache-control']).toContain('no-store');
        await expect(
          page.getByRole('heading', {
            name: 'Reconnecting to the Round',
            exact: true,
          }),
        ).toBeVisible();
        await expect(endSpeech(page)).toHaveCount(0);
        // The Round's own page recovers the same way, and its redirect still applies.
        await receipt.goto(`/rounds/${roundId}`);
        await expect(
          receipt.getByRole('heading', {
            name: 'Reconnecting to the Round',
            exact: true,
          }),
        ).toBeVisible();
      } finally {
        await controlLaunch(`allow-${read}-reads`);
      }
      // Nothing touches either page from here: each must come back by itself.
      // A retry refused just before the lane opened waits again, up to 10 s.
      await expect(endSpeech(page)).toBeEnabled({ timeout: 15_000 });
      await expect(receipt).toHaveURL(new RegExp(`${path}$`), {
        timeout: 15_000,
      });
    }
  } finally {
    await receipt.close();
  }
  await endSpeech(page).click();
  await page
    .getByRole('button', { name: 'Confirm end speech', exact: true })
    .click();
  await expect(async () => {
    const response = await page.request.get(`/api/rounds/${roundId}`);
    const view = roundViewSchema.parse(await response.json());
    expect(view.segments.some((s) => s.endedAt !== null)).toBe(true);
  }).toPass({ timeout: 30_000 });
});
