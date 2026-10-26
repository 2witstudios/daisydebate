import { origin } from './support/accounts';
import { assertNoSeriousFindings } from './support/axe';
import { documentsPath, expect, test } from './support/round-files';

test('the round room: palette, editor, marks and the video divider', async ({
  roundFiles,
}) => {
  const { page, violations } = roundFiles;
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('combobox', { name: 'Search commands' });
  await expect(search).toBeFocused();
  await search.fill('new flow');
  await page.keyboard.press('Enter');
  await expect(
    page
      .getByRole('group', { name: 'Open files' })
      .getByRole('button', { name: 'Flow 2', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  const fresh = page.getByRole('textbox', { name: 'Flow 2' });
  await fresh.locator('li p').first().click();
  await page.keyboard.type('dropped C3');
  await fresh.locator('li p').first().click({ clickCount: 3 });
  await page.getByRole('button', { name: 'Dropped', exact: true }).click();
  await expect(fresh.locator('[data-debate-mark="dropped"]')).toHaveText(
    'dropped C3',
  );
  const divider = page.getByRole('separator', { name: 'Resize video' });
  const start = Number(await divider.getAttribute('aria-valuenow'));
  const box = await divider.boundingBox();
  if (!box) throw new Error('The video divider has no box');
  await page.mouse.move(box.x + 24, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 24, box.y + box.height / 2 + 80, { steps: 4 });
  await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', String(start + 80));
  await divider.focus();
  await page.keyboard.press('ArrowUp');
  await expect(divider).toHaveAttribute('aria-valuenow', String(start + 64));
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
  const flow = page.getByRole('textbox', { name: 'Flow', exact: true });
  await flow.locator('li p').first().click();
  await page.keyboard.type('they dropped the turn');
  await saved;
  expect(await violations.read()).toEqual({
    eventViolations: [],
    consoleViolations: [],
  });
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Files' })
    .getByRole('button', { name: 'Flow', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Flow', exact: true }),
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

test('a resize across the narrow breakpoint returns focus from the hidden drawer', async ({
  roundFiles,
}) => {
  const { page } = roundFiles;
  const phoneTab = page
    .getByRole('navigation', { name: 'Round' })
    .getByRole('button', { name: 'Doc', exact: true });
  await page
    .getByRole('navigation', { name: 'Files' })
    .getByRole('button', { name: 'Flow', exact: true })
    .focus();
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(phoneTab).toBeVisible();
  await expect(phoneTab).toBeFocused();
  // Back up: the tab bar itself hides, so focus lands on the drawer toggle.
  const toggle = page.getByRole('button', { name: /drawer/ });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeFocused();
});

test('the round room: no app shell, the drawer closes, Leave asks first', async ({
  roundFiles,
}) => {
  const { page, roundId } = roundFiles;
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(
    0,
  );
  const toggle = page.getByRole('button', { name: 'Hide drawer' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(
    page.getByRole('complementary', { name: 'Round drawer' }),
  ).toBeHidden();
  await page.getByRole('button', { name: 'Show drawer' }).click();
  await page.getByRole('tab', { name: 'Room', exact: true }).click();
  await expect(
    page.getByRole('tabpanel').getByText('Off', { exact: true }).first(),
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

test('a landscape page and the debate marks from the keyboard', async ({
  roundFiles,
}) => {
  const { page, violations } = roundFiles;
  const flow = page.getByRole('textbox', { name: 'Flow', exact: true });
  const columns = () =>
    flow.evaluate((node) => getComputedStyle(node).columnCount);
  const saved = () =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith(`${documentsPath}save`) && response.ok(),
    );
  await flow.locator('li p').first().click();
  await page.keyboard.type('Kenya');
  await flow.locator('li p').first().click({ clickCount: 3 });
  const formatting = page.getByRole('toolbar', { name: 'Formatting' });
  await formatting.getByRole('button', { name: 'Bold' }).focus();
  await page.keyboard.press('End');
  const marks = formatting.getByRole('group', { name: 'Debate marks' });
  await expect(marks.getByRole('button', { name: 'New' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(marks.getByRole('button', { name: 'Dropped' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  const marked = saved();
  await page.keyboard.press('Enter');
  await expect(flow.locator('[data-debate-mark="extend"]')).toHaveText('Kenya');
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
  await expect(flow.locator('[data-debate-mark="extend"]')).toHaveText('Kenya');
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
  expect(controls.length).toBe(15);
  for (const control of controls) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(targetSize);
    expect(box?.width).toBeGreaterThanOrEqual(targetSize);
  }

  const toggle = page.getByRole('button', { name: 'Hide drawer' });
  await page.getByRole('tab', { name: 'Files', exact: true }).focus();
  await toggle.dispatchEvent('click');
  await expect(
    page.getByRole('complementary', { name: 'Round drawer' }),
  ).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show drawer' })).toBeFocused();

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
    .getByRole('tabpanel')
    .getByRole('button', { name: 'Flow', exact: true })
    .first()
    .focus();
  await tabs
    .getByRole('button', { name: 'Doc', exact: true })
    .dispatchEvent('click');
  await expect(
    tabs.getByRole('button', { name: 'Doc', exact: true }),
  ).toBeFocused();
  await page.getByRole('textbox', { name: 'Flow', exact: true }).focus();
  await tabs
    .getByRole('button', { name: 'Room', exact: true })
    .dispatchEvent('click');
  await expect(
    tabs.getByRole('button', { name: 'Room', exact: true }),
  ).toBeFocused();
});
