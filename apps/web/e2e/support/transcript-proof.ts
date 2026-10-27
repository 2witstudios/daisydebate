import type { Browser, Page } from '@playwright/test';
import { roundTranscriptReadSchema } from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { origin } from './accounts';

/** Actual capture text must reach the mounted viewer before the Round ends. */
export async function expectLiveTranscript(page: Page, roundId: string) {
  const transcript = page.locator('[aria-labelledby="live-transcript"]');
  await transcript.getByText('Show the transcript', { exact: true }).click();
  let text = '';
  await expect(async () => {
    const response = await page.request.get(
      `/api/rounds/${roundId}/transcript`,
    );
    expect(response.status()).toBe(200);
    const value = roundTranscriptReadSchema.parse(await response.json());
    text = value.utterances[0]?.text ?? '';
    expect(text.length).toBeGreaterThan(0);
    await expect(transcript.getByText(text, { exact: false })).toBeVisible();
  }).toPass({ timeout: 50000 });
  await expect(page).toHaveURL(`/rounds/${roundId}/room`);
}

/** Native history navigation reaches the same retained text with JavaScript disabled. */
export async function expectHistoryTranscript(
  browser: Browser,
  page: Page,
  username: string,
  roundId: string,
) {
  const response = await page.request.get(`/api/rounds/${roundId}/transcript`);
  expect(response.status()).toBe(200);
  const value = roundTranscriptReadSchema.parse(await response.json());
  expect(value.utterances.length).toBeGreaterThan(0);
  const native = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: false,
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  try {
    const history = await openPage(
      native,
      'native transcript from match history',
    );
    await history.goto(`/profile/${username}`);
    await history
      .locator(`[aria-label="Match history"] a[href="/rounds/${roundId}"]`)
      .click();
    await expect(history).toHaveURL(`/rounds/${roundId}`);
    const transcript = history.locator('[aria-labelledby="result-transcript"]');
    await transcript.getByText('Show the transcript', { exact: true }).click();
    for (const line of [value.utterances[0]!, value.utterances.at(-1)!])
      await expect(
        transcript.getByText(line.text, { exact: false }).first(),
      ).toBeVisible();
  } finally {
    await native.close();
  }
}
