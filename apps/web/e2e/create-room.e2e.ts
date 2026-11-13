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
  await form.locator('[name="format"][value="policy"]').check();
  await expect(form.locator('[name="resolutionMethod"]')).toHaveValue('policy');
  await form.locator('[name="format"][value="value"]').check();
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
    await form
      .getByRole('button', { name: 'Create room', exact: true })
      .click();
    // RCHAT-13: a ranked Create owes no capture notice, so it is the create
    // itself. No season is open here, so it is refused and the draft is kept.
    await expect(page).toHaveURL(/\/play\/room\?draft=/);
    await expect(
      form.getByText(
        'Ranked rooms are unavailable right now. Turn Ranked off or try again later.',
        { exact: true },
      ),
    ).toBeVisible();
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
    await form.locator('[name="format"][value="value"]').check();
    await form
      .getByRole('button', { name: 'Apply format', exact: true })
      .click();
    await expect(form.locator('[name="format"][value="value"]')).toBeChecked();
    await expect(form.getByLabel('Room name', { exact: true })).toHaveValue(
      'Native custom room',
    );
    // Back into Custom: the discarded edit must not leak; the value preset
    // enables preparation, so the field returns at its preset, not '1:23'.
    await form.locator('[name="format"][value="custom"]').check();
    await form
      .getByRole('button', { name: 'Apply format', exact: true })
      .click();
    await expect(form.locator('[name="format"][value="custom"]')).toBeChecked();
    await expect(form.locator('[name="duration.inRound"]')).not.toHaveValue(
      '1:23',
    );
    await expect(form.locator('[name="duration.inRound"]')).not.toHaveValue(
      '0:00',
    );
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
    const view = await createConfiguredRoom(page);
    roomId = view.id;
    expect(view.capture).toEqual({ broadcast: null, recording: true });
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

test('current selection surfaces show exact owner-confirmed Season 1 publications and labels', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.goto('/play/room');
  const form = formOf(page);
  await hydrated(form);
  const publication = form.locator('.create-room-publication');
  await expect(
    form.locator('[name="format"][value="freestyle"]'),
  ).toBeChecked();
  await expect(
    form.getByText('Chosen by strike before the round'),
  ).toBeVisible();
  await form.locator('[name="format"][value="value"]').check();
  await expect(publication.locator('blockquote')).toHaveText(
    'Resolved: The world would be a better place if traditional sports were replaced by competitive debate.',
  );
  await expect(publication).toContainText(
    'Beta Season 1 · Culture and social priorities',
  );
  const valueId = await form.locator('[name="valueResolutionId"]').inputValue();
  await form.locator('[name="format"][value="policy"]').check();
  await expect(publication.locator('blockquote')).toHaveText(
    'Resolved: Competitive debate should be a mandatory component of the core curriculum in American public education.',
  );
  await expect(publication).toContainText(
    'Beta Season 1 · Education and institutional adoption',
  );
  const current = await (await page.request.get('/api/rooms/catalog')).json();
  const value = current.resolutions.find(
    (entry: { kind: string }) => entry.kind === 'value',
  );
  const policy = current.resolutions.find(
    (entry: { kind: string }) => entry.kind === 'policy',
  );
  expect(value.id).toBe(valueId);
  expect(policy.id).toBe(
    await form.locator('[name="policyResolutionId"]').inputValue(),
  );
  expect([value.provenance, policy.provenance]).toEqual([
    'Owner-confirmed Daisy Beta Season 1 (2026-10-29)',
    'Owner-confirmed Daisy Beta Season 1 (2026-10-29)',
  ]);
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
    expect(view.capture).toEqual({ broadcast: null, recording: true });
    await page.reload();
    await page.getByRole('link', { name: 'Room setup', exact: true }).click();
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
