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

// Help is the front door to the guides: a visitor reads from Help to a
// judging guide, crosses to its Learn article and comes back.
test('Help leads to a guide and its Learn article', async ({ page }) => {
  await page.goto('/help');
  await page.getByRole('link', { name: 'Guides', exact: true }).click();
  await expect(page).toHaveURL(/\/guides$/);
  await page
    .getByRole('link', { name: 'Understanding a Daisy ballot' })
    .click();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Understanding a Daisy ballot',
    }),
  ).toBeVisible();

  await page
    .getByRole('main')
    .getByRole('link', { name: 'Writing a clear reason for decision' })
    .first()
    .click();
  await expect(page).toHaveURL(
    /\/learn\/judging-and-feedback\/writing-a-reason-for-decision$/,
  );
  await page
    .getByRole('link', { name: 'Understanding a Daisy ballot' })
    .click();
  await expect(page).toHaveURL(/\/guides\/judging\/understanding-a-ballot$/);

  const missing = await page.goto('/guides/judging/no-such-guide');
  expect(missing?.status()).toBe(404);
});
