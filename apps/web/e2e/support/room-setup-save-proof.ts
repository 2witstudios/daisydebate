import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { openRoomSetup, saveRoundSettings } from './room-launch-flow';

/** A refused details save must not veto an accepted save from the other form. */
export async function proveSiblingSave(page: Page) {
  await openRoomSetup(page);
  const details = page.getByRole('form', { name: 'Room details' });
  await details.locator('[name="expectedVersion"]').evaluate((input) => {
    const field = input as HTMLInputElement;
    field.value = String(Number(field.value) - 1);
  });
  await details.getByRole('button', { name: 'Save room', exact: true }).click();
  await expect(details.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Room setup' })).toBeVisible();
  await saveRoundSettings(page);
  await expect(
    page.getByRole('heading', { name: 'Seats', exact: true }),
  ).toBeVisible();
  expect(
    await page
      .getByRole('heading', { name: 'Seats', exact: true })
      .evaluate((heading) => heading.closest('[inert]') === null),
  ).toBe(true);
  await openRoomSetup(page);
  await expect(details.getByRole('alert')).toHaveCount(0);
  await page
    .getByRole('link', { name: 'Close room setup', exact: true })
    .click();
}
