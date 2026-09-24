import { expect, type Page } from '@playwright/test';

/** Types a name into the username step and submits it. */
export const claimUsername = async (page: Page, name: string) => {
  await page.getByLabel('Username').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
};

/** Asks /sign-in for a link and waits for the inbox step. */
export async function requestLink(page: Page, email: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByRole('heading', { name: /check your inbox/i }),
  ).toBeVisible();
}

/** Opens the emailed link and takes the confirmation tap. */
export async function confirm(page: Page, link: string) {
  await page.goto(link);
  await page.getByRole('button', { name: 'Sign in to Daisy' }).click();
}
