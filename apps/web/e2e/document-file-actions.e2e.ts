import { createId } from '@paralleldrive/cuid2';
import type { Page } from '@playwright/test';
import { origin } from './support/accounts';
import { expect, openPage, test } from './support/fixtures';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { settledLaunchAuth } from './support/room-launch-settled';

const files = (page: Page) => page.getByRole('navigation', { name: 'Files' });
const folder = async (
  page: Page,
  name: string,
  parentFolderId: string | null = null,
) => {
  const response = await page.request.post('/api/documents/folders/create', {
    headers: { origin },
    data: { name, parentFolderId },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { folder: { id: string } }).folder.id;
};
const createTestDocument = async (
  page: Page,
  folderId: string | null = null,
) => {
  const response = await page.request.post('/api/documents/create', {
    headers: { origin },
    data: { folderId },
  });
  expect(response.status()).toBe(201);
  const created = (
    (await response.json()) as { document: { id: string; title: string } }
  ).document;
  const title = `Notes ${created.id}`;
  const renamed = await page.request.post('/api/documents/rename', {
    headers: { origin },
    data: { id: created.id, title },
  });
  expect(renamed.status()).toBe(200);
  return { ...created, title };
};

test('Move scrolls long destinations, displays nesting and excludes the moving subtree', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const page = await openPage(
      accounts.members[0]!.context,
      'Move destinations',
    );
    await page.setViewportSize({ width: 390, height: 500 });
    const a = await folder(page, 'A');
    const b = await folder(page, 'B');
    await folder(page, 'Evidence', a);
    await folder(page, 'Evidence', b);
    for (let index = 0; index < 12; index++)
      await folder(page, `Destination ${index.toString().padStart(2, '0')}`);
    const doc = await createTestDocument(page);
    await page.goto(`${origin}/prep`);
    await page.getByRole('button', { name: 'Back to Files' }).click();
    await files(page).getByLabel(`Actions for ${doc.title}`).click();
    await page.getByRole('menuitem', { name: 'Move to…' }).click();
    const menu = page.getByRole('menu', { name: `Actions for ${doc.title}` });
    await expect(
      menu.getByRole('menuitem', { name: 'My drive' }),
    ).toBeFocused();
    const bounds = (await menu.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(500);
    const indentWidth = await menu
      .getByRole('menuitem', { name: 'Evidence', exact: true })
      .first()
      .locator('span')
      .evaluate((span) => {
        const range = document.createRange();
        range.setStart(span.firstChild!, 0);
        range.setEnd(span.firstChild!, 2);
        return range.getBoundingClientRect().width;
      });
    expect(indentWidth).toBeGreaterThan(2);
    await page.keyboard.press('End');
    await expect(
      menu.getByRole('menuitem', { name: 'Destination 11' }),
    ).toBeFocused();
    expect(await menu.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await files(page).getByLabel('Actions for A', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Move to…' }).click();
    const movingFolder = page.getByRole('menu', {
      name: 'Actions for A',
      exact: true,
    });
    await expect(
      movingFolder.getByRole('menuitem', { name: 'A', exact: true }),
    ).toHaveCount(0);
    await expect(
      movingFolder.getByRole('menuitem', { name: 'Evidence', exact: true }),
    ).toHaveCount(1);
    await movingFolder
      .getByRole('menuitem', { name: 'B', exact: true })
      .click();
    await files(page).getByRole('button', { name: 'B', exact: true }).click();
    await expect(
      files(page).getByRole('button', { name: 'A', exact: true }),
    ).toBeVisible();
  } finally {
    await settledLaunchAuth();
    await accounts.closeContexts();
  }
});

test('New folder here waits for an expansion already in flight', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const page = await openPage(
      accounts.members[0]!.context,
      'Create in a loading folder',
    );
    const id = await folder(page, 'Cases');
    await page.goto(`${origin}/prep`);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let listing = 0;
    await page.route('**/api/documents/list', async (route) => {
      if (
        (route.request().postDataJSON() as { folderId: string | null })
          .folderId !== id
      )
        return route.continue();
      listing++;
      const stale = await route.fetch();
      await pending;
      await route.fulfill({ response: stale });
    });
    const firstRead = page.waitForRequest(
      (request) =>
        request.url().endsWith('/api/documents/list') &&
        request.postDataJSON().folderId === id,
    );
    await files(page)
      .getByRole('button', { name: 'Cases', exact: true })
      .click();
    await firstRead;
    await files(page).getByLabel('Actions for Cases').click();
    await page.getByRole('menuitem', { name: 'New folder here' }).click();
    release();
    const naming = files(page).getByLabel('Rename New folder');
    await expect(naming).toBeVisible();
    await naming.fill('New child');
    await naming.press('Enter');
    await expect(
      files(page).getByRole('button', { name: 'New child', exact: true }),
    ).toBeVisible();
    expect(listing).toBe(1);
  } finally {
    await settledLaunchAuth();
    await accounts.closeContexts();
  }
});

test('Recent refreshes after saves and focus; local Delete for good closes its tab', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const page = await openPage(
      accounts.members[0]!.context,
      'Recent and deletion',
    );
    const docs = [];
    for (let index = 0; index < 4; index++)
      docs.push(await createTestDocument(page));
    const oldest = docs[0]!;
    await page.goto(`${origin}/prep?open=${oldest.id}`);
    const editor = page.getByRole('textbox', {
      name: oldest.title,
      exact: true,
    });
    await expect(editor).toBeVisible();
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/documents/save') && response.ok(),
    );
    await editor.fill(`Edited ${createId()}`);
    await saved;
    const recent = files(page).getByRole('region', { name: 'Recent' });
    await expect(recent.getByRole('button').first()).toHaveText(oldest.title);
    const newest = await createTestDocument(page);
    const refreshed = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/documents/recent') && response.ok(),
    );
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await refreshed;
    await expect(recent.getByRole('button').first()).toHaveText(newest.title);
    await files(page)
      .getByRole('region', { name: 'My drive' })
      .getByLabel(`Actions for ${oldest.title}`)
      .click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete for good' }).click();
    await expect(
      page.getByRole('button', { name: `Close ${oldest.title}`, exact: true }),
    ).toHaveCount(0);
    await expect(
      files(page).getByRole('button', { name: oldest.title, exact: true }),
    ).toHaveCount(0);
  } finally {
    await settledLaunchAuth();
    await accounts.closeContexts();
  }
});

test('Delete keeps the safe choice through delayed counts and repeated gestures', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const page = await openPage(
      accounts.members[0]!.context,
      'Safe deletion confirmation',
    );
    const doc = await createTestDocument(page);
    await folder(page, 'Cases');
    await page.goto(`${origin}/prep`);
    await files(page)
      .getByLabel(`Actions for ${doc.title}`, { exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    const keep = page.getByRole('menuitem', { name: 'Keep it' });
    const confirm = page.getByRole('menuitem', { name: 'Delete for good' });
    await expect(keep).toBeFocused();
    await confirm.dispatchEvent('click', { detail: 2 });
    await expect(confirm).toBeVisible();
    await confirm.focus();
    expect(
      await confirm.evaluate((button) => {
        const event = new KeyboardEvent('keydown', {
          key: 'Enter',
          repeat: true,
          bubbles: true,
          cancelable: true,
        });
        button.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(true);
    await keep.click();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/documents/folders/count', async (route) => {
      const response = await route.fetch();
      await pending;
      await route.fulfill({ response });
    });
    await files(page).getByLabel('Actions for Cases', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await expect(keep).toBeFocused();
    await expect(confirm).toBeDisabled();
    release();
    await expect(confirm).toBeEnabled();
    await expect(keep).toBeFocused();
    await keep.press('Enter');
    await expect(
      files(page).getByRole('button', { name: 'Cases', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: doc.title, exact: true }),
    ).toBeVisible();
  } finally {
    await settledLaunchAuth();
    await accounts.closeContexts();
  }
});

test('finishing rename by clicking the editor preserves the new typing target', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const page = await openPage(accounts.members[0]!.context, 'Rename focus');
    const doc = await createTestDocument(page);
    await page.goto(`${origin}/prep?open=${doc.id}`);
    const editor = page.getByRole('textbox', { name: doc.title, exact: true });
    await expect(editor).toBeVisible();
    await files(page)
      .getByLabel(`Actions for ${doc.title}`, { exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await files(page).getByLabel(`Rename ${doc.title}`).fill('Renamed notes');
    await editor.click();
    await expect(
      page.getByRole('textbox', { name: 'Renamed notes', exact: true }),
    ).toBeFocused();
    await page.keyboard.type('Typing stays in the editor');
    await expect(
      page.getByRole('textbox', { name: 'Renamed notes', exact: true }),
    ).toContainText('Typing stays in the editor');
    await files(page)
      .getByLabel('Actions for Renamed notes', { exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await files(page).getByLabel('Rename Renamed notes').press('Escape');
    await expect(
      files(page)
        .getByRole('region', { name: 'My drive' })
        .getByRole('button', { name: 'Renamed notes', exact: true }),
    ).toBeFocused();
  } finally {
    await settledLaunchAuth();
    await accounts.closeContexts();
  }
});
