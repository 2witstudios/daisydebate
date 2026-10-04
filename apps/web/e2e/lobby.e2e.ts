import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { resetRateLimits, signUpMember } from './support/accounts';

/**
 * The lobby lists sample rooms (ISSUE-303) and keeps its whole state in the
 * URL: the list filters and sorts on the server, so a link, a reload and a
 * browser with no script all give the same rooms.
 */
test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

const rows = (page: Page): Locator =>
  page.getByRole('region', { name: 'Rooms' }).getByRole('listitem');

const names = (page: Page): Promise<string[]> =>
  rows(page).locator('p.text-md').allTextContents();

test.describe('lobby list', () => {
  test.beforeEach(async ({ page }) => {
    await signUpMember(page.request);
  });

  test('lists open tables and live rooms, closest to the viewer first', async ({
    page,
  }) => {
    await page.goto('/lobby');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lobby');
    await expect(rows(page)).toHaveCount(8);
    expect((await names(page)).slice(0, 3)).toEqual([
      'Quarterfinal practice',
      'Anything goes',
      'Tuesday night, no mercy',
    ]);
    const first = rows(page).first();
    await expect(first).toContainText('Ranked');
    await expect(first).toContainText('Standard rules');
    await expect(first).toContainText('Open seat');
    await expect(first).toContainText('1200–1400');
    await expect(first).toContainText('Waiting 9 min');
  });

  test('tab, mode, range, search and sort come from the URL', async ({
    page,
  }) => {
    await page.goto('/lobby?tab=live&sort=watched');
    expect(await names(page)).toEqual([
      'Finals rehearsal',
      'Ranked, serious only',
      'Friendly spar',
    ]);
    await expect(rows(page).first()).toContainText('31 watching');

    await page.goto('/lobby?mode=ranked&sort=low');
    expect(await names(page)).toEqual([
      'Quarterfinal practice',
      'Tuesday night, no mercy',
      'Ranked, serious only',
      'Finals rehearsal',
      'Top of the ladder',
    ]);

    await page.goto('/lobby?range=100&sort=high');
    expect(await names(page)).toEqual([
      'Anything goes',
      'Quarterfinal practice',
    ]);

    await page.goto('/lobby?q=%40host-two');
    expect(await names(page)).toEqual(['Newcomers welcome']);
  });

  test('bad parameters fall back to the defaults', async ({ page }) => {
    await page.goto('/lobby?tab=nope&sort=%00&range=9');
    await expect(rows(page)).toHaveCount(8);
  });

  test('a ranked table whose band excludes the viewer cannot be taken', async ({
    page,
  }) => {
    await page.goto('/lobby?tab=open');
    const ladder = rows(page).filter({ hasText: 'Top of the ladder' });
    await expect(
      ladder.getByRole('button', { name: /^Take seat/ }),
    ).toBeDisabled();
    await expect(ladder.getByRole('link')).toHaveCount(0);
    const tuesday = rows(page).filter({ hasText: 'Tuesday night' });
    await expect(
      tuesday.getByRole('link', { name: /^Take seat/ }),
    ).toHaveAttribute('href', '/rooms/room-tuesday-night');
    const spar = page.getByRole('link', { name: /^Spectate, Friendly spar/ });
    await page.goto('/lobby?tab=live');
    await expect(spar).toHaveAttribute('href', '/watch');
  });

  test('an empty result offers Clear filters and keeps the tab', async ({
    page,
  }) => {
    await page.goto('/lobby?tab=live&q=zzz');
    await expect(page.getByText('No rooms match these filters')).toBeVisible();
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL(/\/lobby\?tab=live$/);
    await expect(rows(page)).toHaveCount(3);
  });

  test('tabs are links that keep the other filters', async ({ page }) => {
    await page.goto('/lobby?mode=ranked');
    await page.getByRole('link', { name: /^Live/ }).click();
    await expect(page).toHaveURL(/\/lobby\?tab=live&mode=ranked$/);
    await expect(page.getByRole('link', { name: /^Live/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(rows(page)).toHaveCount(2);
  });

  test('with script, changing a select applies it at once', async ({
    page,
  }) => {
    await page.goto('/lobby');
    await page.getByLabel('Sort by').selectOption('high');
    await expect(page).toHaveURL(/sort=high/);
    expect((await names(page))[0]).toBe('Top of the ladder');
  });

  test('desktop shows the filters; the phone hides them behind Filters', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/lobby');
    await expect(page.getByLabel('Rating range')).toBeVisible();
    await expect(
      page.getByRole('group', { name: 'Rated or casual' }),
    ).toBeVisible();
    await expect(page.getByText('Filters', { exact: true })).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel('Rating range')).toBeHidden();
    await expect(page.getByText('8 rooms')).toBeVisible();
    await page.getByText('Filters', { exact: true }).click();
    await expect(page.getByLabel('Rating range')).toBeVisible();
    await expect(
      page.getByRole('group', { name: 'Rated or casual' }),
    ).toBeVisible();
  });
});

test.describe('lobby with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });

  test.beforeEach(async ({ page }) => {
    await signUpMember(page.request);
  });

  test('the filter form is a GET that puts its state in the URL', async ({
    page,
  }) => {
    await page.goto('/lobby');
    await expect(rows(page)).toHaveCount(8);
    await page.getByLabel('Search rooms or hosts').fill('debater');
    await page.getByLabel('Sort by').selectOption('low');
    await page
      .getByRole('group', { name: 'Rated or casual' })
      .getByText('Ranked')
      .click();
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/q=debater/);
    await expect(page).toHaveURL(/mode=ranked/);
    await expect(page).toHaveURL(/sort=low/);
    expect(await names(page)).toEqual([
      'Ranked, serious only',
      'Finals rehearsal',
    ]);
    // The result is the same one the link gives a browser with script.
    await page.goto(page.url());
    expect(await names(page)).toEqual([
      'Ranked, serious only',
      'Finals rehearsal',
    ]);
  });

  test('tabs and Clear are links; the panel is a native details', async ({
    page,
  }) => {
    await page.goto('/lobby?q=friendly&tab=live');
    expect(await names(page)).toEqual(['Friendly spar']);
    await page.getByRole('link', { name: 'Clear', exact: true }).click();
    await expect(page).toHaveURL(/\/lobby\?tab=live$/);
    await page.getByRole('link', { name: /^Open tables/ }).click();
    await expect(page).toHaveURL(/tab=open/);
    await expect(rows(page)).toHaveCount(5);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel('Rating range')).toBeHidden();
    await page.getByText('Filters', { exact: true }).click();
    await expect(page.getByLabel('Rating range')).toBeVisible();
  });
});
