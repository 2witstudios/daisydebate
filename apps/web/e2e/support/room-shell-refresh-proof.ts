import type { Page } from '@playwright/test';
import { expect } from './fixtures';

/** A native document reload would hide the retained-layout bug, so assert it never occurs. */
export async function proveClosedRoomNavigation(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByText('Close room', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Close room for everyone', exact: true })
    .click();
  await expect(page.getByText('Closed', { exact: true })).toBeVisible();
  const documentRequests: string[] = [];
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documentRequests.push(request.url());
  });
  await page
    .getByRole('navigation', { name: 'Primary', exact: true })
    .getByRole('link', { name: 'More', exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /^Return to room:/ }),
  ).toHaveCount(0);
  expect(documentRequests).toEqual([]);
}
