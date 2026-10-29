import { createId } from '@paralleldrive/cuid2';
import { expect, openPage, test } from './support/fixtures';
import { signUpMember, origin } from './support/accounts';
import { closeRoom, reread } from './support/room-launch-flow';
import { hydrated } from './support/hydration';

const formOf = (page: import('@playwright/test').Page) =>
  page.getByRole('form', { name: 'Create a room' });

test('editing settings makes Custom and clears Ranked; a standard restores its complete preset', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.goto('/play/room');
  await hydrated(formOf(page));
  const form = formOf(page);
  const ranked = form.getByRole('checkbox', { name: 'Ranked', exact: true });
  await expect(form.locator('[name="format"][value="value"]')).toBeChecked();
  await expect(ranked).not.toBeChecked();
  await ranked.check();
  await form.getByLabel('Room name', { exact: true }).fill('Preserved title');
  await expect(ranked).toBeChecked();
  await form
    .getByText('Speeches and question periods', { exact: false })
    .click();
  const duration = form.locator('[name="duration.segment.0"]');
  const original = await duration.inputValue();
  await duration.fill('4:32.123');
  await expect(form.locator('[name="format"][value="custom"]')).toBeChecked();
  await expect(ranked).not.toBeChecked();
  await expect(ranked).toBeDisabled();
  await form.locator('[name="format"][value="policy"]').check();
  await expect(form.locator('[name="resolutionMethod"]')).toHaveValue('policy');
  await form.locator('[name="format"][value="value"]').check();
  await expect(duration).toHaveValue(original);
  await expect(ranked).not.toBeChecked();
  await expect(form.getByLabel('Room name', { exact: true })).toHaveValue(
    'Preserved title',
  );
});

test('Custom POI, exact timing and custom resolution persist through the real create flow', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.goto('/play/room');
  await hydrated(formOf(page));
  const form = formOf(page);
  await form
    .getByLabel('Room name', { exact: true })
    .fill(`Custom ${createId().slice(0, 8)}`);
  await form.locator('[name="resolutionMethod"]').selectOption('custom');
  await form
    .getByLabel('Custom resolution', { exact: true })
    .fill('Cities should build more homes.');
  await form
    .getByText('Speeches and question periods', { exact: false })
    .click();
  await form.locator('[name="duration.segment.0"]').fill('4:32.123');
  await form.getByText('Questions and floor rules', { exact: true }).click();
  await form.locator('[name="questionStyle"]').selectOption('poi');
  await form.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\/[a-z0-9]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  try {
    const view = await reread(page.request, id);
    expect(view.topic).toBe('Cities should build more homes.');
    expect(view.competitionType).toBe('casual');
    expect(view.format.standing.kind).toBe('custom');
    expect(view.rules.interaction.interruptions?.allowed).toBe('open');
    expect(view.rules.segments[0]?.durationMs).toBe(272123);
  } finally {
    await closeRoom(page.request, id);
  }
});

test('native format, resolution and speech editing create a room without JavaScript', async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: false,
  });
  const page = await openPage(context, 'native create-room editor');
  let roomId: string | undefined;
  try {
    await signUpMember(context.request);
    await page.goto('/play/room');
    const form = formOf(page);
    await form
      .getByLabel('Room name', { exact: true })
      .fill('Native custom room');
    await form.locator('[name="format"][value="policy"]').check();
    await form
      .getByRole('button', { name: 'Apply format', exact: true })
      .click();
    await expect(form.locator('[name="resolutionMethod"]')).toHaveValue(
      'policy',
    );
    await form.locator('[name="resolutionMethod"]').selectOption('custom');
    await form
      .getByRole('button', { name: 'Apply resolution', exact: true })
      .click();
    await form
      .getByLabel('Custom resolution', { exact: true })
      .fill('Cities should build more homes.');
    await form
      .getByText('Speeches and question periods', { exact: false })
      .click();
    await form
      .getByRole('button', { name: 'Add affirmative speech', exact: true })
      .click();
    await expect(form.locator('[name="format"][value="custom"]')).toBeChecked();
    await form
      .getByRole('button', { name: 'Create room', exact: true })
      .click();
    await expect(page).toHaveURL(/\/rooms\/[a-z0-9]+$/);
    roomId = new URL(page.url()).pathname.split('/').at(-1)!;
    const view = await reread(context.request, roomId);
    expect(view.topic).toBe('Cities should build more homes.');
    expect(view.format.standing.kind).toBe('custom');
  } finally {
    if (roomId) await closeRoom(context.request, roomId);
    await context.close();
  }
});

test('create-room layout fits narrow screens and exposes the full editor', async ({
  page,
}, testInfo) => {
  await signUpMember(page.request);
  await page.goto('/play/room');
  await hydrated(formOf(page));
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      formOf(page).getByRole('button', { name: 'Create room', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`create-room-${width}.png`),
      fullPage: true,
    });
  }
  await formOf(page)
    .getByText('Speeches and question periods', { exact: false })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('Custom offers searchable league starting points and Strike stays one option', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.goto('/play/room');
  const form = formOf(page);
  await hydrated(form);
  await form.locator('[name="format"][value="custom"]').check();
  await form.getByText('Start from a league template', { exact: true }).click();
  await form
    .getByLabel('Search formats and leagues')
    .fill('NSDA Lincoln-Douglas');
  const templates = form.locator('[name="template"]');
  const option = templates
    .locator('option')
    .filter({ hasText: 'NSDA Lincoln-Douglas' });
  const value = await option.getAttribute('value');
  expect(value).toBeTruthy();
  await templates.selectOption(value!);
  await expect(form.locator('[name="format"][value="custom"]')).toBeChecked();
  await expect(
    form.getByRole('checkbox', { name: 'Ranked', exact: true }),
  ).toBeDisabled();
  await form.locator('[name="resolutionMethod"]').selectOption('strike');
  await expect(
    form.getByLabel('Custom resolution', { exact: true }),
  ).toBeHidden();
  await expect(
    form.locator(
      '[name="drawSize"], [name="strikeWindowMs"], [name="firstStriker"]',
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole('complementary', { name: 'Room preview' }),
  ).toContainText('Strike time is additional.');
});
