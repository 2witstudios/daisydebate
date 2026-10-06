import { expect, type Page } from '@playwright/test';

/** Ticks the choice whose label reads `label` on the current step. */
const choose = (page: Page, label: string) =>
  page.locator('label', { hasText: label }).click();

/**
 * The whole flow after the passkey offer: three intro steps, the three
 * questionnaire steps saved one by one, and the last step showing both
 * ways into a first debate and the saved answers. onboarding.e2e.ts runs
 * it with JavaScript and journey-no-js.e2e.ts without.
 */
export const walkOnboarding = async (page: Page) => {
  await expect(page).toHaveURL(/\/onboarding\/welcome\?next=(\/|%2F)lobby$/);
  await expect(
    page.getByRole('heading', {
      name: 'Debate is self-defense for free speech.',
    }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Next' }).click();
  await expect(
    page.getByRole('heading', { name: 'How Daisy works' }),
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
  await choose(page, 'Quick');
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible();
  await choose(page, 'Ethics');
  await choose(page, 'Law');
  await page.getByRole('button', { name: 'Finish' }).click();

  await expect(page).toHaveURL(/\/onboarding\/ready\?next=(\/|%2F)lobby$/);
  await expect(
    page.getByRole('link', { name: /Debate a bot/ }),
  ).toHaveAttribute('href', '/train');
  await expect(
    page.getByRole('link', { name: /Debate a real person/ }),
  ).toHaveAttribute('href', '/play');
  for (const answer of [
    'Debate, Watch',
    'On my own',
    'Debated in class or a club',
    'One-on-one · Quick',
    'Ethics, Law',
  ])
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
};
