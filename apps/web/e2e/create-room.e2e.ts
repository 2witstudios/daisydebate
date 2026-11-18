import { createId } from '@paralleldrive/cuid2';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { casualCaptureNotice } from '../src/features/legal/agreements';
import { expect, openPage, test } from './support/fixtures';
import { signUpMember, origin } from './support/accounts';
import { closeRoom, createConfiguredRoom } from './support/room-launch-flow';
import { hydrated } from './support/hydration';

const formOf = (page: import('@playwright/test').Page) =>
  page.getByRole('form', { name: 'Create a room' });

test('Custom settings edits clear Ranked; a standard restores its complete preset', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.goto('/play/room');
  await hydrated(formOf(page));
  const form = formOf(page);
  const ranked = form.getByRole('checkbox', { name: 'Ranked', exact: true });
  await expect(
    form.locator('[name="format"][value="freestyle"]'),
  ).toBeChecked();
  await expect(ranked).not.toBeChecked();
  await ranked.check();
  await form.getByLabel('Room name', { exact: true }).fill('Preserved title');
  await expect(ranked).toBeChecked();
  await form.locator('[name="format"][value="custom"]').check();
  await form
    .getByText('Speeches and question periods', { exact: false })
    .click();
  const duration = form.locator('[name="duration.segment.0"]');
  const original = await duration.inputValue();
  await duration.fill('4:32.123');
  await expect(form.locator('[name="format"][value="custom"]')).toBeChecked();
  await expect(ranked).not.toBeChecked();
  await expect(ranked).toBeDisabled();
  await form.locator('[name="format"][value="freestyle"]').check();
  await expect(
    form.locator('[name="format"][value="freestyle"]'),
  ).toBeChecked();
  await expect(form.locator('[name="resolutionMethod"]')).toHaveValue('strike');
  await form.locator('[name="format"][value="custom"]').check();
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
  const view = await createConfiguredRoom(page);
  const id = view.id;
  try {
    expect(view.topic).toBe('Cities should build more homes.');
    expect(view.competitionType).toBe('casual');
    expect(view.format.standing.kind).toBe('custom');
    expect(view.rules.interaction.interruptions?.allowed).toBe('open');
    expect(view.rules.segments[0]?.durationMs).toBe(272123);
  } finally {
    await closeRoom(page.request, id);
  }
});

/**
 * Every Fill seat menu is out of sight until its own opener asks for it, and
 * closes back out of sight. The menus are found with includeHidden, so a menu
 * that is closed but still laid out on the page (SEAT-14a: a bare `flex`
 * beat the browser's closed-popover rule) fails here, where a
 * `:popover-open` count could not see it.
 */
const fillMenusStayHiddenUntilAsked = async (
  page: import('@playwright/test').Page,
) => {
  const menus = page.getByRole('dialog', {
    name: /^Fill /,
    includeHidden: true,
  });
  const openers = page.getByRole('button', { name: /^Fill / });
  const count = await openers.count();
  expect(count).toBeGreaterThan(0);
  await expect(menus).toHaveCount(count);
  for (const menu of await menus.all()) await expect(menu).toBeHidden();
  for (const opener of await openers.all()) {
    const name = (await opener.getAttribute('aria-label')) ?? '';
    const menu = page.getByRole('dialog', {
      name,
      exact: true,
      includeHidden: true,
    });
    await opener.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
};

test('a new Room opens as just the room: no seat menu shows until someone asks for one', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.goto('/play/room');
  await hydrated(formOf(page));
  await formOf(page)
    .getByLabel('Room name', { exact: true })
    .fill(`Plain ${createId().slice(0, 8)}`);
  const view = await createConfiguredRoom(page);
  try {
    const opener = page.getByRole('button', { name: /^Fill / }).first();
    await hydrated(opener);
    // Nothing on the page pulls focus into a closed menu (a server-rendered
    // autofocus did, and the browser then showed the menu on load).
    expect(
      await page.evaluate(
        () => document.activeElement?.closest('[popover]') ?? null,
      ),
    ).toBeNull();
    await fillMenusStayHiddenUntilAsked(page);
    await opener.click();
    // Opening it still moves focus to the choice.
    await expect(
      page
        .getByRole('dialog', { name: /^Fill / })
        .locator('select[name="actorId"]'),
    ).toBeFocused();
  } finally {
    await closeRoom(page.request, view.id);
  }
});

test('without JavaScript a new Room shows no seat menu until its opener is pressed', async ({
  browser,
  page,
}) => {
  await signUpMember(page.request);
  await page.goto('/play/room');
  await hydrated(formOf(page));
  await formOf(page)
    .getByLabel('Room name', { exact: true })
    .fill(`Native ${createId().slice(0, 8)}`);
  const view = await createConfiguredRoom(page);
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  try {
    const native = await openPage(context, 'native room page');
    await native.goto(`/rooms/${view.id}`);
    await fillMenusStayHiddenUntilAsked(native);
  } finally {
    await context.close();
    await closeRoom(page.request, view.id);
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
    await form
      .getByRole('checkbox', { name: 'Record match', exact: true })
      .check();
    const ranked = form.getByRole('checkbox', { name: 'Ranked', exact: true });
    await ranked.check();
    // RCHAT-13: a ranked draft owes no capture notice. A native render shows
    // it; Create is not pressed, since whether a ranked create is accepted
    // depends on a season being open, which other specs in this run decide.
    // Apply resolution re-renders the draft as posted; Apply format would
    // reset it to the preset and clear Ranked.
    await form
      .getByRole('button', { name: 'Apply resolution', exact: true })
      .click();
    await expect(page).toHaveURL(/\/play\/room\?draft=/);
    await expect(ranked).toBeChecked();
    await expect(
      form.getByText('Recording is on for ranked matches.', { exact: true }),
    ).toBeVisible();
    await expect(form.getByText(casualCaptureNotice.text)).toHaveCount(0);
    await expect(form.locator('[name="noticeVersion"]')).toHaveCount(0);
    // Back to casual with the recording choice kept: the next native render
    // shows the casual notice before any create can claim it. Settings render
    // only for Custom, so the native editor applies Custom first; the
    // submission posts no settings and starts at the preset.
    await ranked.uncheck();
    await form.locator('[name="format"][value="custom"]').check();
    await form
      .getByRole('button', { name: 'Apply format', exact: true })
      .click();
    await expect(form.locator('[name="format"][value="custom"]')).toBeChecked();
    await expect(
      form.getByRole('checkbox', { name: 'Record match', exact: true }),
    ).toBeChecked();
    await expect(
      form.getByText(casualCaptureNotice.text, { exact: true }),
    ).toBeVisible();
    const prep = form.locator('[name="duration.inRound"]');
    await form.getByText('Preparation and timing', { exact: true }).click();
    await prep.fill('1:23');
    await form
      .getByRole('button', { name: 'Apply resolution', exact: true })
      .click();
    await expect(form.locator('[name="format"][value="custom"]')).toBeChecked();
    await form.locator('[name="format"][value="freestyle"]').check();
    await form
      .getByRole('button', { name: 'Apply format', exact: true })
      .click();
    await expect(
      form.locator('[name="format"][value="freestyle"]'),
    ).toBeChecked();
    await expect(form.getByLabel('Room name', { exact: true })).toHaveValue(
      'Native custom room',
    );
    // Back into Custom: the discarded edit must not leak; the field returns
    // at Freestyle's preset (no prep during the round), not '1:23'.
    await form.locator('[name="format"][value="custom"]').check();
    await form
      .getByRole('button', { name: 'Apply format', exact: true })
      .click();
    await expect(form.locator('[name="format"][value="custom"]')).toBeChecked();
    await expect(form.locator('[name="duration.inRound"]')).toHaveValue('0:00');
    await form.locator('[name="format"][value="freestyle"]').check();
    await form
      .getByRole('button', { name: 'Apply format', exact: true })
      .click();
    // Freestyle always strikes; host wording below makes the draft Custom.
    await expect(form.locator('[name="resolutionMethod"]')).toHaveValue(
      'strike',
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
    const view = await createConfiguredRoom(page);
    roomId = view.id;
    expect(view.capture).toEqual({
      broadcast: null,
      recordingPolicy: 'released',
    });
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
  await formOf(page).locator('[name="format"][value="custom"]').check();
  await formOf(page)
    .getByText('Speeches and question periods', { exact: false })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('Custom offers a league template selector and Strike stays one option', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.goto('/play/room');
  const form = formOf(page);
  await hydrated(form);
  await form.locator('[name="format"][value="custom"]').check();
  await form.getByText('Start from a league template', { exact: true }).click();
  await expect(form.getByRole('searchbox')).toHaveCount(0);
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

test('Freestyle is the one standard: two format radios, Strike or Custom wording, no published resolution', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.goto('/play/room');
  const form = formOf(page);
  await hydrated(form);
  await expect(form.locator('[name="format"]')).toHaveCount(2);
  await expect(
    form.locator('[name="format"][value="freestyle"]'),
  ).toBeChecked();
  await expect(form.locator('[name="format"][value="custom"]')).toHaveCount(1);
  await expect(form.locator('[name="resolutionMethod"] option')).toHaveText([
    'Strike',
    'Custom',
  ]);
  await expect(
    form.getByText('Chosen by strike before the round'),
  ).toBeVisible();
  await expect(
    form.getByRole('checkbox', { name: 'Ranked', exact: true }),
  ).toBeEnabled();
  await expect(
    form.getByText('Freestyle · Open or Youth, set by the debaters', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(form.locator('.create-room-publication')).toHaveCount(0);
  await expect(
    form.locator('[name="policyResolutionId"], [name="valueResolutionId"]'),
  ).toHaveCount(0);
  const catalog = await (await page.request.get('/api/rooms/catalog')).json();
  expect(catalog.resolutions).toBeUndefined();
  expect(
    catalog.choices
      .filter((choice: { role: string }) => choice.role === 'standard')
      .map((choice: { formatId: string }) => choice.formatId),
  ).toEqual(['freestyle']);
});

test('Record match stays visible and Ranked shows automatic recording without losing the casual choice', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.goto('/play/room');
  await hydrated(formOf(page));
  const form = formOf(page);
  const recording = form.getByRole('checkbox', {
    name: 'Record match',
    exact: true,
  });
  const ranked = form.getByRole('checkbox', { name: 'Ranked', exact: true });
  const notice = form.getByText('Recording is on for ranked matches.', {
    exact: true,
  });
  await expect(recording).toBeVisible();
  await expect(recording).not.toBeChecked();
  await ranked.check();
  await expect(recording).toBeChecked();
  await expect(recording).toBeDisabled();
  await expect(notice).toBeVisible();
  // RCHAT-13: the waiver is the ranked agreement, so Ranked shows and posts no capture notice.
  await expect(form.getByText(casualCaptureNotice.text)).toHaveCount(0);
  await expect(form.locator('[name="noticeVersion"]')).toHaveCount(0);
  await ranked.uncheck();
  await expect(recording).not.toBeChecked();
  await expect(recording).toBeEnabled();
  await recording.check();
  await ranked.check();
  await ranked.uncheck();
  await expect(recording).toBeChecked();
  await form.getByLabel('Room name', { exact: true }).fill('Recorded match');
  const view = await createConfiguredRoom(page);
  try {
    expect(view.capture).toEqual({
      broadcast: null,
      recordingPolicy: 'released',
    });
    await page.reload();
    await page
      .getByRole('link', { name: 'Edit settings', exact: true })
      .click();
    await expect(
      page.getByRole('checkbox', { name: 'Record this round', exact: true }),
    ).toBeChecked();
  } finally {
    await closeRoom(page.request, view.id);
  }
});

test('Post-round feedback is a casual choice: Ranked switches it off, and the Room keeps it', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.goto('/play/room');
  await hydrated(formOf(page));
  const form = formOf(page);
  const feedback = form.getByRole('checkbox', {
    name: 'Post-round feedback',
    exact: true,
  });
  const ranked = form.getByRole('checkbox', { name: 'Ranked', exact: true });
  await expect(feedback).toBeVisible();
  await expect(feedback).not.toBeChecked();
  await feedback.check();
  await ranked.check();
  await expect(feedback).not.toBeChecked();
  await expect(feedback).toBeDisabled();
  await ranked.uncheck();
  await expect(feedback).toBeEnabled();
  await expect(feedback).toBeChecked();
  await form.getByLabel('Room name', { exact: true }).fill('Feedback match');
  const view = await createConfiguredRoom(page);
  try {
    expect(view.postRoundCall).toBe(true);
  } finally {
    await closeRoom(page.request, view.id);
  }
});

test('a recording subscription refusal keeps the draft and notice, and turning it off creates normally', async ({
  page,
}) => {
  const { username } = await signUpMember(page.request);
  await promisify(execFile)(
    'bun',
    [
      fileURLToPath(
        new URL(
          './support/withdraw-casual-capture-process.ts',
          import.meta.url,
        ),
      ),
      username,
    ],
    { timeout: 20_000 },
  );
  await page.goto('/play/room');
  await hydrated(formOf(page));
  const form = formOf(page);
  const recording = form.getByRole('checkbox', {
    name: 'Record match',
    exact: true,
  });
  await form
    .getByLabel('Room name', { exact: true })
    .fill('Retained recording draft');
  await recording.check();
  await expect(
    form.getByText(casualCaptureNotice.text, { exact: true }),
  ).toBeVisible();
  await form.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(
    form.getByText(
      'Recording a casual match requires a subscription. Turn Record match off to create this room.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(recording).toBeChecked();
  await expect(form.getByLabel('Room name', { exact: true })).toHaveValue(
    'Retained recording draft',
  );
  await expect(
    form.locator('[name="format"][value="freestyle"]'),
  ).toBeChecked();
  await expect(
    form.getByRole('checkbox', { name: 'Ranked', exact: true }),
  ).not.toBeChecked();
  await recording.uncheck();
  await expect(
    form.getByText(casualCaptureNotice.text, { exact: true }),
  ).toHaveCount(0);
  await expect(form.locator('[name="noticeVersion"]')).toHaveCount(0);
  const view = await createConfiguredRoom(page);
  try {
    expect(view.capture).toBeNull();
  } finally {
    await closeRoom(page.request, view.id);
  }
});
