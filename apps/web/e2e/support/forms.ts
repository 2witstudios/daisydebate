import { expect, type Page } from '@playwright/test';

/** Types a name into the username step and submits it. */
export const claimUsername = async (page: Page, name: string) => {
  await page.getByLabel('Username').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
};

/** Declines the passkey offer and lands on the lobby. */
export const declineOfferToLobby = async (page: Page) => {
  await page.getByRole('link', { name: 'Not now' }).click();
  await expect(page).toHaveURL(/\/lobby$/);
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
};
