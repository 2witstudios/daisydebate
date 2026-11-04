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
    await expect(
      files(page).getByRole('menuitem', { includeHidden: true }),
    ).toHaveCount(0);
    await files(page)
      .getByRole('button', { name: `Actions for ${doc.title}`, exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Move to…' }).click();
    const menu = page.getByRole('menu', { name: `Actions for ${doc.title}` });
    await expect(
      menu.getByRole('menuitem', { name: 'My drive' }),
    ).toBeFocused();
    await menu
      .getByRole('menuitem', { name: 'My drive', exact: true })
      .dispatchEvent('click', { detail: 2 });
    await expect(menu).toBeVisible();
    expect(
      await menu
        .getByRole('menuitem', { name: 'My drive', exact: true })
        .evaluate((button) => {
          const repeated = new KeyboardEvent('keydown', {
            key: 'Enter',
            repeat: true,
            bubbles: true,
            cancelable: true,
          });
          button.dispatchEvent(repeated);
          return repeated.defaultPrevented;
        }),
    ).toBe(true);
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
    await files(page)
      .getByRole('button', { name: 'Actions for A', exact: true })
      .click();
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
    await files(page)
      .getByRole('button', { name: 'Actions for Cases', exact: true })
      .click();
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
      .getByRole('button', { name: `Actions for ${oldest.title}`, exact: true })
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
      .getByRole('button', { name: `Actions for ${doc.title}`, exact: true })
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
    await files(page)
      .getByRole('button', { name: 'Actions for Cases', exact: true })
      .click();
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
    const originalView = await editor.elementHandle();
    await editor.fill('Text before rename');
    await files(page)
      .getByRole('button', { name: `Actions for ${doc.title}`, exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await files(page).getByLabel(`Rename ${doc.title}`).fill('Renamed notes');
    await editor.click();
    await expect(
      page.getByRole('textbox', { name: 'Renamed notes', exact: true }),
    ).toBeFocused();
    expect(await originalView!.evaluate((node) => node.isConnected)).toBe(true);
    await expect(
      page.getByRole('textbox', { name: 'Renamed notes', exact: true }),
    ).toContainText('Text before rename');
    await page.keyboard.type('Typing stays in the editor');
    await expect(
      page.getByRole('textbox', { name: 'Renamed notes', exact: true }),
    ).toContainText('Typing stays in the editor');
    await files(page)
      .getByRole('button', { name: 'Actions for Renamed notes', exact: true })
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

test('new palette queries never open a hit from a previous query', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const page = await openPage(
      accounts.members[0]!.context,
      'Search query ordering',
    );
    const current = await createTestDocument(page);
    const oldHit = await createTestDocument(page);
    await page.goto(`${origin}/prep?open=${current.id}`);
    await expect(
      page.getByRole('textbox', { name: current.title, exact: true }),
    ).toBeVisible();
    await page.route('**/api/documents/search', async (route) => {
      const text = (route.request().postDataJSON() as { text: string }).text;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          hits:
            text === 'inherency'
              ? [
                  {
                    id: oldHit.id,
                    title: oldHit.title,
                    snippet: 'inherency evidence',
                    folderId: null,
                  },
                ]
              : [],
        }),
      });
    });
    await files(page).getByRole('button', { name: 'Search files' }).click();
    const search = page.getByRole('combobox', { name: 'Search commands' });
    await search.fill('inherency');
    await expect(
      page.getByRole('option', { name: new RegExp(oldHit.title) }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await files(page).getByRole('button', { name: 'Search files' }).click();
    await search.fill('topicality');
    await search.press('Enter');
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('textbox', { name: current.title, exact: true }),
    ).toBeVisible();
  } finally {
    await settledLaunchAuth();
    await accounts.closeContexts();
  }
});

test('drive retries preserve save warnings and known folder destinations', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const page = await openPage(accounts.members[0]!.context, 'Drive notices');
    const doc = await createTestDocument(page);
    await folder(page, 'Cases');
    await page.goto(`${origin}/prep?open=${doc.id}`);
    const workspace = page.getByRole('region', {
      name: 'Your files',
      exact: true,
    });
    await page.route('**/api/documents/rename', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{}',
      }),
    );
    await files(page)
      .getByRole('button', { name: `Actions for ${doc.title}`, exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    const naming = files(page).getByLabel(`Rename ${doc.title}`);
    await naming.fill('New title');
    await naming.press('Enter');
    await expect(
      workspace
        .getByRole('alert')
        .filter({ hasText: 'That change did not save' }),
    ).toBeVisible();
    await page.route('**/api/documents/save', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: '{}',
      }),
    );
    await page
      .getByRole('textbox', { name: doc.title, exact: true })
      .fill('Text requiring a visible save warning');
    await expect(
      workspace.getByRole('alert').filter({ hasText: 'current access' }),
    ).toBeVisible();
    await page.unroute('**/api/documents/rename');
    await files(page)
      .getByRole('button', { name: `Actions for ${doc.title}`, exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await files(page).getByLabel(`Rename ${doc.title}`).fill('New title');
    await files(page).getByLabel(`Rename ${doc.title}`).press('Enter');
    await expect(
      workspace
        .getByRole('alert')
        .filter({ hasText: 'That change did not save' }),
    ).toHaveCount(0);
    await expect(
      workspace.getByRole('alert').filter({ hasText: 'current access' }),
    ).toBeVisible();
    await page.route('**/api/documents/folders', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{}',
      }),
    );
    await files(page)
      .getByRole('button', { name: 'Actions for New title', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Move to…' }).click();
    const menu = page.getByRole('menu', {
      name: 'Actions for New title',
      exact: true,
    });
    await expect(
      menu.getByRole('menuitem', { name: 'Cases', exact: true }),
    ).toBeVisible();
    await expect(menu.getByRole('alert')).toContainText(
      'Folder destinations did not load',
    );
    await page.keyboard.press('Escape');
    await page.route('**/api/documents/folders/create', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: '{}',
      }),
    );
    await files(page).getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('option', { name: /Folder/ }).click();
    await expect(
      workspace
        .getByRole('alert')
        .filter({ hasText: 'drive is full or too deep' }),
    ).toBeVisible();
  } finally {
    await settledLaunchAuth();
    await accounts.closeContexts();
  }
});

test('failed document search says it did not run rather than no matches', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const page = await openPage(accounts.members[0]!.context, 'Search failure');
    await page.goto(`${origin}/prep`);
    await page.route('**/api/documents/search', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{}',
      }),
    );
    await files(page).getByRole('button', { name: 'Search files' }).click();
    await page
      .getByRole('combobox', { name: 'Search commands' })
      .fill('unreachable evidence');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette.getByRole('alert')).toContainText(
      'Search did not run',
    );
    await expect(palette.getByText('No matches', { exact: true })).toHaveCount(
      0,
    );
  } finally {
    await settledLaunchAuth();
    await accounts.closeContexts();
  }
});

test('the first document load preserves an active Files menu and Recent paints with the tree', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const page = await openPage(
      accounts.members[0]!.context,
      'Initial Files intent',
    );
    const doc = await createTestDocument(page);
    await folder(page, 'Cases');
    const html = await page.request
      .get('/prep')
      .then((response) => response.text());
    expect(html.includes('<section aria-label="Recent"')).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/api/documents/recent')) reads++;
    });
    const loaded = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/documents/read') && response.ok(),
    );
    await page.route('**/api/documents/read', async (route) => {
      const response = await route.fetch();
      await waiting;
      await route.fulfill({ response });
    });
    await page.goto(`${origin}/prep`);
    await files(page)
      .getByRole('button', { name: 'Actions for Cases', exact: true })
      .click();
    const menu = page.getByRole('menu', {
      name: 'Actions for Cases',
      exact: true,
    });
    await expect(menu).toBeVisible();
    release();
    await loaded;
    await expect(menu).toBeVisible();
    await expect(files(page)).toBeVisible();
    expect(reads).toBe(1);
    await page.keyboard.press('Escape');
    await files(page)
      .getByRole('region', { name: 'My drive' })
      .getByRole('button', { name: doc.title, exact: true })
      .click();
    await expect(
      page.getByRole('textbox', { name: doc.title, exact: true }),
    ).toBeVisible();
  } finally {
    await settledLaunchAuth();
    await accounts.closeContexts();
  }
});
