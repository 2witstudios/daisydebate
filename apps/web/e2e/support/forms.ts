import { expect, type Page } from '@playwright/test';

/** Types a name into the username step and submits it. */
export const claimUsername = async (page: Page, name: string) => {
  await page.getByLabel('Username').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
};

/** Types a new address into the account-security email change and submits it. */
export const changeEmail = async (page: Page, newEmail: string) => {
  await page.getByLabel('New email address').fill(newEmail);
  await page.getByRole('button', { name: 'Change email' }).click();
};

/** Declines the passkey offer and lands on the lobby. */
export const declineOfferToLobby = async (page: Page) => {
  await page.getByRole('link', { name: 'Not now' }).click();
  await expect(page).toHaveURL(/\/lobby$/);
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
};

/** Drops every server-action POST the page makes, as a lost connection would. */
export const dropServerActions = (page: Page) =>
  page.route('**/*', (route) =>
    route.request().method() === 'POST' &&
    route.request().headers()['next-action'] !== undefined
      ? route.abort('internetdisconnected')
      : route.continue(),
  );
