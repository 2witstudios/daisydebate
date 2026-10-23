import { openPage } from './support/fixtures';
import { test, expect } from './support/round-files';
import { roundViewSchema } from '@daisy/protocol';
test.use({ roundCommands: true });
for (const command of ['yield', 'forfeit'] as const)
  test(`unknown accepted ${command} keeps its exact reachable retry across fresh canonical state`, async ({
    roundFiles,
  }) => {
    const { page, roundId } = roundFiles;
    for (const name of ['Start round', 'Use prep', 'Start AC'])
      await page.getByRole('button', { name, exact: true }).click();
    const label = command === 'yield' ? 'End speech' : 'Forfeit round';
    await page.getByRole('button', { name: label, exact: true }).click();
    const confirm = page.getByRole('button', {
      name: `Confirm ${label.toLowerCase()}`,
      exact: true,
    });
    await expect(confirm).toBeVisible();
    const original = Object.fromEntries(
      await confirm
        .locator('..')
        .locator('input[name]')
        .evaluateAll((inputs) =>
          inputs.map((input) => [
            (input as HTMLInputElement).name,
            (input as HTMLInputElement).value,
          ]),
        ),
    );
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
    expect(
      Object.fromEntries(
        await retry
          .locator('..')
          .locator('input[name]')
          .evaluateAll((inputs) =>
            inputs.map((input) => [
              (input as HTMLInputElement).name,
              (input as HTMLInputElement).value,
            ]),
          ),
      ),
    ).toEqual(original);
    const beforeRetry = await read();
    await retry.click();
    if (command === 'yield')
      await expect(
        page.getByRole('status').filter({ hasText: 'Command accepted' }),
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
    for (const name of ['Start round', 'Use prep', 'Start AC', 'End speech'])
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
