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
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page).toHaveURL(/\/lobby$/);
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
};

/**
 * Reaches one of the passkey offer's decline choices with the keyboard
 * alone (plain Tab, in every engine — ISSUE-75: WebKit skipped them on Tab
 * while they were links) and activates it with Enter, landing on the
 * destination.
 */
export const declineByKeyboard = async (
  page: Page,
  name: 'Not now' | 'This is a shared computer',
) => {
  const control = page.getByRole('button', { name });
  for (
    let tab = 0;
    tab < 10 &&
    !(await control.evaluate((el) => el === document.activeElement));
    tab += 1
  )
    await page.keyboard.press('Tab');
  await expect(control).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/lobby$/);
};

/** Drops every server-action POST the page makes, as a lost connection would. */
export const dropServerActions = (page: Page) =>
  page.route('**/*', (route) =>
    route.request().method() === 'POST' &&
    route.request().headers()['next-action'] !== undefined
      ? route.abort('internetdisconnected')
      : route.continue(),
  );
