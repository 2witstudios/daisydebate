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

  // A same-page link changes the hash through history.pushState, which
  // fires no hashchange; the answer still opens.
  await page.evaluate(() => {
    history.pushState(null, '', '/help#teams');
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(
    page.locator('details', { has: page.locator('summary#teams') }),
  ).toHaveAttribute('open', '');
});
