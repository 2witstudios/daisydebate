import type { Locator } from '@playwright/test';
import { openPage } from './support/fixtures';
import { test, expect } from './support/round-files';
import { controlLaunch } from './support/room-launch-settled';
import { roundViewSchema } from '@daisy/protocol';
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
    roundFiles,
  }) => {
    const { page, roundId } = roundFiles;
    for (const name of ['Take prep time', 'Start affirmative constructive'])
      await page.getByRole('button', { name, exact: true }).click();
    const label = command === 'yield' ? 'End speech' : 'Forfeit round';
    await page.getByRole('button', { name: label, exact: true }).click();
    const confirm = page.getByRole('button', {
      name: `Confirm ${label.toLowerCase()}`,
      exact: true,
    });
    await expect(confirm).toBeVisible();
    const original = await commandFields(confirm);
    let committed = false;
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
    const read = async () => {
      const response = await page.request.get(`/api/rounds/${roundId}`);
      expect(response.status()).toBe(200);
      return roundViewSchema.parse(await response.json());
    };
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
    expect(await commandFields(retry)).toEqual(original);
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

test('native browser retry resubmits the original accepted command after a lost HTTP acknowledgement', async ({
  roundFiles,
  browser,
}) => {
  const { page, roundId } = roundFiles;
  const native = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  try {
    const formPage = await openPage(native, 'native command replay');
    await formPage.goto(`/rounds/${roundId}/room`);
    for (const name of [
      'Take prep time',
      'Start affirmative constructive',
      'End speech',
    ])
      await formPage.getByRole('button', { name, exact: true }).click();
    const confirm = formPage.getByRole('button', {
      name: 'Confirm end speech',
      exact: true,
    });
    await expect(confirm).toBeVisible();
    const commandId = await confirm
      .locator('..')
      .locator('input[name=commandId]')
      .inputValue();
    const posts: string[] = [];
    await formPage.route(`**/rounds/${roundId}/room`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posts.push(route.request().postData() ?? '');
      if (posts.length !== 1) return route.continue();
      const response = await route.fetch({ maxRedirects: 0 });
      expect(response.status()).toBe(303);
      await route.fulfill({
        status: 503,
        contentType: 'text/plain',
        body: 'Lost native command acknowledgement',
      });
    });
    await confirm.click();
    await expect(
      formPage.getByText('Lost native command acknowledgement', {
        exact: true,
      }),
    ).toBeVisible();
    const before = roundViewSchema.parse(
      await (await native.request.get(`/api/rounds/${roundId}`)).json(),
    );
    expect(before.segments[0]?.endedAt).toEqual(expect.any(String));
    await formPage.reload();
    await expect(formPage).toHaveURL(`/rounds/${roundId}/room`);
    expect(posts.length).toBe(2);
    expect(posts.every((body) => body.includes(commandId))).toBe(true);
    const after = roundViewSchema.parse(
      await (await native.request.get(`/api/rounds/${roundId}`)).json(),
    );
    expect(after.version).toBe(before.version);
    expect(after.segments).toEqual(before.segments);
  } finally {
    await native.close();
  }
});

test('a capacity refusal on a mid-speech reload recovers on its own, End speech included, with and without JavaScript (ISSUE-927)', async ({
  roundFiles,
  browser,
}) => {
  test.setTimeout(240_000);
  const { page, roundId } = roundFiles;
  const path = `/rounds/${roundId}/room`;
  for (const name of ['Take prep time', 'Start affirmative constructive'])
    await page.getByRole('button', { name, exact: true }).click();
  const endSpeech = (seat: typeof page) =>
    seat.getByRole('button', { name: 'End speech', exact: true });
  await expect(endSpeech(page)).toBeEnabled();
  const native = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  try {
    const formPage = await openPage(native, 'native refused reload');
    await formPage.goto(path);
    const seats = [page, formPage];
    for (const read of ['round', 'identity'] as const) {
      await controlLaunch(`refuse-${read}-reads`);
      try {
        for (const seat of seats) {
          const answer = await seat.reload();
          // A Next page cannot choose a 5xx; it can stay uncacheable.
          expect(answer?.headers()['cache-control']).toContain('no-store');
          await expect(
            seat.locator('meta[http-equiv="refresh"]'),
          ).toHaveAttribute('content', /^[234]$/);
          await expect(
            seat.getByRole('heading', {
              name: 'Reconnecting to the Round',
              exact: true,
            }),
          ).toBeVisible();
          await expect(endSpeech(seat)).toHaveCount(0);
        }
      } finally {
        await controlLaunch(`allow-${read}-reads`);
      }
      // Nothing touches either page from here: each must come back by itself.
      for (const seat of seats) await expect(endSpeech(seat)).toBeEnabled();
    }
    await endSpeech(formPage).click();
    await formPage
      .getByRole('button', { name: 'Confirm end speech', exact: true })
      .click();
    await expect(async () => {
      const response = await native.request.get(`/api/rounds/${roundId}`);
      const view = roundViewSchema.parse(await response.json());
      expect(view.segments.some((s) => s.endedAt !== null)).toBe(true);
    }).toPass({ timeout: 30_000 });
  } finally {
    await native.close();
  }
});
