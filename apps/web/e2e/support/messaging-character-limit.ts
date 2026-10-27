import { expect } from '@playwright/test';
import { test } from './fixtures';
import { effectsRan } from './hydration';
import {
  acceptMessagingJourney,
  openMessagingJourney,
} from './messaging-journey';

/**
 * ISSUE-642 (DEC-124): the composer counts UTF-16 units against the beta
 * limit; one unit over is announced and blocked without cutting the draft,
 * and exactly the limit sends.
 */
export function testComposerCharacterLimit() {
  test('the composer counts UTF-16 units and blocks one over without truncating', async ({
    browser,
  }) => {
    const journey = await openMessagingJourney(browser);
    try {
      const page = await acceptMessagingJourney(journey);
      await effectsRan(page);
      const composer = page.getByLabel('Your message');
      // A supplementary character is two units: 3,999 + 2 is one over.
      const over = `${'x'.repeat(3999)}😀`;
      await composer.fill(over);
      await expect(page.getByText('4,001 / 4,000 characters')).toBeVisible();
      await expect(page.locator('#message-text-over')).toHaveText(
        '1 character over the limit. Shorten it to send.',
      );
      await expect(composer).toHaveAttribute('aria-invalid', 'true');
      await page
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      await expect(composer).toHaveValue(over);
      expect(
        await composer.evaluate((field) => field.matches(':invalid')),
      ).toBe(true);
      const exact = `${'x'.repeat(3998)}😀`;
      await composer.fill(exact);
      await expect(page.getByText('4,000 / 4,000 characters')).toBeVisible();
      await expect(composer).not.toHaveAttribute('aria-invalid');
      await page
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      await expect(page).toHaveURL(/\?sent=[a-z0-9]{24}$/);
      await expect(page.getByText(exact, { exact: true })).toBeVisible();
    } finally {
      await journey.close();
    }
  });
}
