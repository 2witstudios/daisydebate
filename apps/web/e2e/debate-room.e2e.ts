import { origin } from './support/accounts';
import { assertNoSeriousFindings } from './support/axe';
import { openPage } from './support/fixtures';
import { documentsPath, expect, test } from './support/round-files';

test('the round room: palette and editor', async ({ roundFiles }) => {
  const { page, violations } = roundFiles;
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('combobox', { name: 'Search commands' });
  await expect(search).toBeFocused();
  await search.fill('new document');
  await page.keyboard.press('Enter');
  await expect(
    page
      .getByRole('group', { name: 'Open files' })
      .getByRole('button', { name: 'Untitled 2', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  const fresh = page.getByRole('textbox', { name: 'Untitled 2' });
  await fresh.locator('p').first().click();
  await page.keyboard.type('dropped C3');
  await fresh.locator('p').first().click({ clickCount: 3 });
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(fresh.locator('strong')).toHaveText('dropped C3');
  expect(await violations.read()).toEqual({
    eventViolations: [],
    consoleViolations: [],
  });
});

test('the round room has no serious or critical accessibility findings', async ({
  roundFiles,
}) => {
  await assertNoSeriousFindings(roundFiles.page);
  await roundFiles.page.keyboard.press('ControlOrMeta+k');
  await expect(
    roundFiles.page.getByRole('combobox', { name: 'Search commands' }),
  ).toBeFocused();
  await assertNoSeriousFindings(roundFiles.page);
});

test('the participant’s persisted files survive editing and reload', async ({
  roundFiles,
}) => {
  const { page, violations } = roundFiles;
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`${documentsPath}save`) && response.ok(),
  );
  const flow = page.getByRole('textbox', { name: 'Untitled', exact: true });
  await flow.locator('p').first().click();
  await page.keyboard.type('they dropped the turn');
  await saved;
  expect(await violations.read()).toEqual({
    eventViolations: [],
    consoleViolations: [],
  });
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Files' })
    .getByRole('button', { name: 'Untitled', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Untitled', exact: true }),
  ).toContainText('they dropped the turn');
});

test('private file rename and stale or cross-account refusal preserve the stored document', async ({
  roundFiles,
}) => {
  const { page, stranger, roundId, documentId } = roundFiles;
  const list = async () => {
    const response = await page.request.post(`${documentsPath}list`, {
      headers: { origin },
      data: { roundId },
    });
    expect(response.status()).toBe(200);
    return response.json();
  };
  const renamed = await page.request.post(`${documentsPath}rename`, {
    headers: { origin },
    data: { id: documentId, title: 'My transit flow' },
  });
  expect(renamed.status()).toBe(200);
  const saved = await page.request.post(`${documentsPath}save`, {
    headers: { origin },
    data: {
      id: documentId,
      html: '<p>Accepted notes</p>',
      expectedRevision: 1,
    },
  });
  expect(saved.status()).toBe(200);
  const before = await list();
  for (const [request, path, data, status] of [
    [stranger, 'list', { roundId }, 404],
    [stranger, 'rename', { id: documentId, title: 'Forbidden' }, 404],
    [
      stranger,
      'save',
      { id: documentId, html: '<p>Forbidden</p>', expectedRevision: 1 },
      404,
    ],
    [
      page.request,
      'save',
      { id: documentId, html: '<p>Stale</p>', expectedRevision: 1 },
      409,
    ],
  ] as const) {
    const response = await request.post(`${documentsPath}${path}`, {
      headers: { origin },
      data,
    });
    expect(response.status()).toBe(status);
    expect(await list()).toEqual(before);
  }
  await page.reload();
  await expect(
    page.getByRole('textbox', { name: 'My transit flow', exact: true }),
  ).toBeVisible();
});

test('a resize across the phone breakpoint returns focus from the hidden Files', async ({
  roundFiles,
}) => {
  const { page } = roundFiles;
  const phoneTab = page
    .getByRole('navigation', { name: 'Round' })
    .getByRole('button', { name: 'Doc', exact: true });
  await page
    .getByRole('navigation', { name: 'Files' })
    .getByRole('button', { name: 'Untitled', exact: true })
    .focus();
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(phoneTab).toBeVisible();
  await expect(phoneTab).toBeFocused();
  // Back up: the tab bar itself hides, so focus lands on Hide files.
  const toggle = page.getByRole('button', { name: 'Hide files' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeFocused();
});

test('the round room: no app shell, Files closes, the sidebar switches, Leave asks first', async ({
  roundFiles,
}) => {
  const { page, roundId } = roundFiles;
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(
    0,
  );
  const hide = page.getByRole('button', { name: 'Hide files' });
  await expect(hide).toHaveAttribute('aria-expanded', 'true');
  await hide.click();
  await expect(
    page.getByRole('complementary', { name: 'Your files' }),
  ).toBeHidden();
  await page.getByRole('button', { name: 'Show files' }).click();
  await page.getByRole('tab', { name: 'Channels', exact: true }).click();
  await page.getByRole('button', { name: '# round' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Message # round' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Back to channels' }).click();
  await page.getByRole('tab', { name: 'AI chat', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Ask Assistant' }),
  ).toBeDisabled();
  await page.getByRole('tab', { name: 'Transcript', exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Your files' })
    .getByText('Room', { exact: true })
    .click();
  await expect(
    page
      .getByRole('complementary', { name: 'Your files' })
      .getByText('Off', { exact: true })
      .first(),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Leave round' }).click();
  const confirm = page.getByRole('dialog', { name: 'Leave the round?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('link', { name: 'Stay', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(page).toHaveURL(`/rounds/${roundId}/room`);
  await page.getByRole('link', { name: 'Leave round' }).click();
  // Leaving a live Round forfeits it, then shows its result (ADR 0070).
  await confirm
    .getByRole('button', { name: 'Leave and forfeit', exact: true })
    .click();
  await expect(page).toHaveURL(`/rounds/${roundId}`);
});

test('a landscape page and formatting from the keyboard', async ({
  roundFiles,
}) => {
  const { page, violations } = roundFiles;
  const flow = page.getByRole('textbox', { name: 'Untitled', exact: true });
  const columns = () =>
    flow.evaluate((node) => getComputedStyle(node).columnCount);
  const saved = () =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith(`${documentsPath}save`) && response.ok(),
    );
  await flow.locator('p').first().click();
  await page.keyboard.type('Kenya');
  await flow.locator('p').first().click({ clickCount: 3 });
  const formatting = page.getByRole('toolbar', { name: 'Formatting' });
  await formatting.getByRole('button', { name: 'Bold' }).focus();
  await page.keyboard.press('End');
  await expect(
    formatting.getByRole('button', { name: 'Checklist' }),
  ).toBeFocused();
  await page.keyboard.press('Home');
  await expect(formatting.getByRole('button', { name: 'Bold' })).toBeFocused();
  const marked = saved();
  await page.keyboard.press('Enter');
  await expect(flow.locator('strong')).toHaveText('Kenya');
  await marked;
  const laidOut = saved();
  await page.getByRole('combobox', { name: 'Page' }).selectOption({
    label: 'Landscape · 3 columns',
  });
  await laidOut;
  expect(await columns()).toBe('3');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Page' })).toHaveValue('3');
  expect(await columns()).toBe('3');
  await expect(flow.locator('strong')).toHaveText('Kenya');
  expect(await violations.read()).toEqual({
    eventViolations: [],
    consoleViolations: [],
  });
});

const targetSize = 44;

test('the round editor’s targets, the phone toolbar row and focus return', async ({
  roundFiles,
}) => {
  const { page } = roundFiles;
  const formatting = page.getByRole('toolbar', { name: 'Formatting' });
  const controls = [
    ...(await formatting.getByRole('button').all()),
    page.getByRole('combobox', { name: 'Page' }),
    page.getByRole('button', { name: 'Smaller text' }),
    page.getByRole('button', { name: 'Larger text' }),
    page.getByRole('button', { name: 'Dark page' }),
    page.getByRole('button', { name: 'Light page' }),
  ];
  await expect(page.locator('[data-room-page]')).toHaveCount(0);
  expect(controls.length).toBe(10);
  for (const control of controls) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(targetSize);
    expect(box?.width).toBeGreaterThanOrEqual(targetSize);
  }

  const toggle = page.getByRole('button', { name: 'Hide files' });
  await toggle.focus();
  await toggle.dispatchEvent('click');
  await expect(
    page.getByRole('complementary', { name: 'Your files' }),
  ).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show files' })).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  const row = await formatting.evaluate((node) => {
    const bar = node.parentElement!;
    const tops = new Set(
      [...bar.querySelectorAll('button, select')].map((tool) =>
        Math.round(tool.getBoundingClientRect().top),
      ),
    );
    return { rows: tops.size, scrolls: bar.scrollWidth > bar.clientWidth };
  });
  expect(row).toEqual({ rows: 1, scrolls: true });

  const tabs = page.getByRole('navigation', { name: 'Round' });
  await tabs.getByRole('button', { name: 'Files', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Files' })
    .getByRole('button', { name: 'Untitled', exact: true })
    .focus();
  await tabs
    .getByRole('button', { name: 'Doc', exact: true })
    .dispatchEvent('click');
  await expect(
    tabs.getByRole('button', { name: 'Doc', exact: true }),
  ).toBeFocused();
  await page.getByRole('textbox', { name: 'Untitled', exact: true }).focus();
  await tabs
    .getByRole('button', { name: 'Room', exact: true })
    .dispatchEvent('click');
  await expect(
    tabs.getByRole('button', { name: 'Room', exact: true }),
  ).toBeFocused();
});

test('the round room fits the viewport and the workspace starts on one line', async ({
  roundFiles,
}) => {
  const { page } = roundFiles;
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('tab', { name: 'Transcript' })).toBeVisible();
  const fit = await page.evaluate(() => ({
    pageScrolls:
      document.documentElement.scrollHeight >
      document.documentElement.clientHeight,
  }));
  expect(fit.pageScrolls).toBe(false);
  const tops = await Promise.all(
    [
      page.getByRole('complementary', { name: 'Your files' }),
      page.getByRole('region', { name: 'Document' }),
      page.getByRole('complementary', { name: 'Round sidebar' }),
    ].map(async (region) => Math.round((await region.boundingBox())?.y ?? -1)),
  );
  expect(new Set(tops).size).toBe(1);
  // A window too short for the frame scrolls, so the phone's tabs stay reachable.
  await page.setViewportSize({ width: 390, height: 500 });
  const lastTab = page
    .getByRole('navigation', { name: 'Round' })
    .getByRole('button', { name: 'Room', exact: true });
  await lastTab.scrollIntoViewIfNeeded();
  await expect(lastTab).toBeInViewport();
});

test('without JavaScript a phone reads the transcript and keeps Leave', async ({
  roundFiles,
  browser,
}) => {
  const { page } = roundFiles;
  const native = await browser.newContext({
    baseURL: origin,
    javaScriptEnabled: false,
    ignoreHTTPSErrors: false,
    viewport: { width: 390, height: 844 },
    storageState: await page.context().storageState(),
  });
  try {
    const phone = await openPage(native, 'no-JavaScript phone room');
    await phone.goto(new URL(page.url()).pathname);
    await expect(
      phone.getByRole('complementary', { name: 'Round sidebar' }),
    ).toBeVisible();
    await expect(
      phone.locator('[aria-labelledby="live-transcript"]'),
    ).toBeVisible();
    await expect(phone.getByRole('region', { name: 'Document' })).toBeVisible();
    await expect(phone.getByRole('link', { name: /Leave/ })).toBeVisible();
  } finally {
    await native.close();
  }
});
