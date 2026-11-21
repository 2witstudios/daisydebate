import { expect, type Page } from '@playwright/test';

/** Ticks the choice whose label reads `label` on the current step. */
const choose = (page: Page, label: string) =>
  page.locator('label', { hasText: label }).click();

/**
 * The whole flow after the passkey offer: five intro steps, the three
 * questionnaire steps saved one by one, and the last step's simple send-off
 * to the lobby.
 */
export const walkOnboarding = async (page: Page, destination = '/lobby') => {
  await expect(page).toHaveURL(/\/onboarding\/daisy\?next=/);
  expect(new URL(page.url()).searchParams.get('next')).toBe(destination);
  await expect(
    page.getByRole('heading', {
      name: 'How Daisy works',
    }),
  ).toBeVisible();
  for (const heading of [
    'Freestyle, Daisy’s standard',
    'A Freestyle round, step by step',
    'Practise your league',
    'Run your league',
  ]) {
    await page.getByRole('link', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();
  await choose(page, 'Debate');
  await choose(page, 'Watch');
  await choose(page, 'On my own');
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Experience' })).toBeVisible();
  await choose(page, 'Debated in class or a club');
  await choose(page, 'NSDA');
  await page.getByLabel('Another league').fill('Golden State Debate');
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible();
  await choose(page, 'Ethics');
  await choose(page, 'Law');
  await page.getByRole('button', { name: 'Finish' }).click();

  await expect(page).toHaveURL(/\/onboarding\/ready\?next=/);
  expect(new URL(page.url()).searchParams.get('next')).toBe(destination);
  await expect(
    page.getByRole('heading', { name: /you're ready/i }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Enter the lobby' }),
  ).toHaveAttribute('href', destination);
};
