import { signUpMember } from './support/accounts';
import { expect, test } from './support/fixtures';
import {
  STUB_BALLOT,
  STUB_REPLY,
  STUB_SPEECH,
  STUB_TRANSCRIPT,
} from './support/openrouter-stub';

// Chromium's fake microphone (a steady tone) stands in for the person, and
// the server's OpenRouter stub stands in for the AI, so the real routes,
// timeline, recorder, player and turn-taking run end to end.
test.use({
  launchOptions: {
    args: [
      '--ignore-certificate-errors',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
  permissions: ['microphone'],
});

type Page = import('@playwright/test').Page;

const heading = (page: Page, name: string) =>
  page.getByRole('heading', { name, exact: true });

// Every turn without prep opens with a ten-second countdown.
const afterCountdown = { timeout: 20_000 };

/** Ending something takes a second tap, so a stray one never does. */
const end = async (page: Page, name: string) => {
  await page.getByRole('button', { name }).click();
  await page.getByRole('button', { name: 'Tap again to confirm' }).click();
};

test('a member plays a full IPDA debate against the AI by voice and gets a ballot', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signUpMember(page.request);

  await page.goto('/ai-debate');
  await page
    .getByLabel('Resolution')
    .fill('Cities should make public transit free');
  await page.getByLabel('Affirmative', { exact: true }).check();
  await page.getByRole('button', { name: 'Go to the debate room' }).click();
  await expect(page).toHaveURL(/\/ai-debate\/[a-z0-9]+$/);

  await page.getByRole('button', { name: 'Begin debate' }).click();

  // The countdown into the AC, with the round laid out as a timeline.
  await expect(
    heading(page, 'Up next: Affirmative constructive'),
  ).toBeVisible();
  await expect(page.getByText('until you speak')).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Round timeline' }).getByRole('listitem'),
  ).toHaveCount(7);

  // AC: the person speaks, then ends their speech early.
  await expect(heading(page, 'Affirmative constructive')).toBeVisible(
    afterCountdown,
  );
  await expect(page.getByText('left in your speech')).toBeVisible();
  // The fake microphone "speaks" for a few seconds: shorter clips are
  // dropped as silence before transcription.
  await page.waitForTimeout(4_000);
  await end(page, 'End my speech');

  // First CX: the AI asks its opening question out loud.
  await expect(
    heading(page, 'Cross-examination of the affirmative'),
  ).toBeVisible(afterCountdown);
  await expect(page.getByText(STUB_REPLY).first()).toBeVisible({
    timeout: 15_000,
  });
  await end(page, 'End cross-examination');

  // NC: the AI speaks and yields when it is done; the person then asks.
  await expect(heading(page, 'Cross-examination of the negative')).toBeVisible({
    timeout: 45_000,
  });
  await end(page, 'End cross-examination');

  // Prep (no countdown: prep is the break), then the 1AR.
  await expect(heading(page, 'Prep before your 1AR')).toBeVisible();
  await page.getByRole('button', { name: 'Start my speech' }).click();
  await expect(heading(page, 'First affirmative rebuttal')).toBeVisible();
  await end(page, 'End my speech');

  // NR by the AI, then prep and the 2AR.
  await expect(heading(page, 'Prep before your 2AR')).toBeVisible({
    timeout: 45_000,
  });
  await page.getByRole('button', { name: 'Start my speech' }).click();
  await expect(heading(page, 'Second affirmative rebuttal')).toBeVisible();
  await end(page, 'End my speech');

  // The judge's ballot.
  await expect(heading(page, 'You won the round')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(STUB_BALLOT.reason)).toBeVisible();
  await expect(page.getByText('The AI').first()).toBeHidden();

  // The transcript holds the person's transcribed speech and the AI's words.
  const transcript = page.locator('section', {
    has: heading(page, 'Transcript'),
  });
  await expect(transcript.getByText(STUB_TRANSCRIPT).first()).toBeVisible();
  await expect(transcript.getByText(STUB_SPEECH).first()).toBeVisible();
});
