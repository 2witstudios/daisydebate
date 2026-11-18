import { expect, test } from './support/fixtures';

// A link to one Help answer opens it: on arrival, and from About's common
// questions through a client navigation.
test('a link to a Help topic opens its answer', async ({ page }) => {
  await page.goto('/help#ratings');
  const ratings = page.locator('details', {
    has: page.locator('summary#ratings'),
  });
  await expect(ratings).toHaveAttribute('open', '');
  await expect(
    page.locator('details', { has: page.locator('summary#judging') }),
  ).not.toHaveAttribute('open', '');

  await page.goto('/about');
  await page
    .getByRole('link', { name: 'Why are ranked rounds recorded?' })
    .click();
  await expect(page).toHaveURL(/\/help#ranked-recorded$/);
  await expect(
    page.locator('details', { has: page.locator('summary#ranked-recorded') }),
  ).toHaveAttribute('open', '');

  // An answer the member closes stays closed.
  await page.locator('summary#ranked-recorded').click();
  await page.locator('summary#judging').click();
  await expect(
    page.locator('details', { has: page.locator('summary#ranked-recorded') }),
  ).not.toHaveAttribute('open', '');
});
