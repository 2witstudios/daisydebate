import { expect, type Page } from '@playwright/test';

/** Ticks the choice whose label reads `label` on the current step. */
const choose = (page: Page, label: string) =>
  page.locator('label', { hasText: label }).click();

/**
 * The whole flow after the passkey offer: three intro steps, the three
 * questionnaire steps saved one by one, and the last step's simple send-off
 * to the lobby. onboarding.e2e.ts runs it with JavaScript and
 * journey-no-js.e2e.ts without.
 */
export const walkOnboarding = async (page: Page) => {
  await expect(page).toHaveURL(/\/onboarding\/daisy\?next=(\/|%2F)lobby$/);
  await expect(
    page.getByRole('heading', {
      name: 'How Daisy works',
    }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Next' }).click();
  await expect(
    page.getByRole('heading', { name: 'Ranked ladders and custom formats' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Next' }).click();
  await expect(
    page.getByRole('heading', { name: 'How a debate works' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();
  await choose(page, 'Debate');
  await choose(page, 'Watch');
  await choose(page, 'On my own');
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Experience' })).toBeVisible();
  await choose(page, 'Debated in class or a club');
  await choose(page, 'One-on-one');
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible();
  await choose(page, 'Ethics');
  await choose(page, 'Law');
  await page.getByRole('button', { name: 'Finish' }).click();

  await expect(page).toHaveURL(/\/onboarding\/ready\?next=(\/|%2F)lobby$/);
  await expect(
    page.getByRole('heading', { name: /you're ready/i }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Enter the lobby' }),
  ).toHaveAttribute('href', '/lobby');
};
