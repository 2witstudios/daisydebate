import { createId } from '@paralleldrive/cuid2';
import type { APIRequestContext, Page } from '@playwright/test';
import { origin } from './support/accounts';
import { assertNoSeriousFindings } from './support/axe';
import { watchCspViolations } from './support/csp';
import { expect, test as base, openPage } from './support/fixtures';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { prepareJudgeRoom } from './support/room-launch-flow';
import { settledLaunchAuth } from './support/room-launch-settled';

const documentsPath = '/api/debate-room/documents/';
type RoundFiles = {
  readonly page: Page;
  readonly stranger: APIRequestContext;
  readonly roundId: string;
  readonly documentId: string;
};
const test = base.extend<{ roundFiles: RoundFiles }>({
  roundFiles: async ({ browser }, provide) => {
    const accounts = await createRoomLaunchAccounts(browser, 2);
    try {
      const page = await openPage(
        accounts.members[0]!.context,
        'persisted Round files',
      );
      await prepareJudgeRoom(page, `Round files ${createId().slice(0, 8)}`);
      await page
        .getByRole('button', { name: 'I am ready', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Not ready', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Launch', exact: true }).click();
      await expect(page).toHaveURL(/\/rounds\/[a-z0-9]+$/);
      const roundId = new URL(page.url()).pathname.split('/').at(-1)!;
      const created = await page.request.post(`${documentsPath}create`, {
        headers: { origin },
        data: { roundId, folder: 'round', templateId: 'flow' },
      });
      expect(created.status()).toBe(201);
      const { document } = await created.json();
      expect(document.id).toMatch(/^[a-z0-9]{24}$/);
      expect(document.title).toBe('Flow');
      await page.reload();
      await expect(
        page.getByRole('textbox', { name: 'Flow', exact: true }),
      ).toBeVisible();
      await provide({
        page,
        roundId,
        documentId: document.id,
        stranger: accounts.members[1]!.context.request,
      });
    } finally {
      // Competitive history stays in the dedicated slot until reviewed lifecycle release.
      try {
        await settledLaunchAuth();
      } finally {
        await accounts.closeContexts();
      }
    }
  },
});

test('persisted Round files: palette, editor, marks and dividers', async ({
  roundFiles,
}) => {
  const { page } = roundFiles;
  const violations = await watchCspViolations(page);
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('combobox', { name: 'Search commands' });
  await expect(search).toBeFocused();
  await search.fill('new flow');
  await page.keyboard.press('Enter');
  await expect(
    page
      .getByRole('group', { name: 'Open files' })
      .getByRole('button', { name: 'Flow 2', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  const fresh = page.getByRole('textbox', { name: 'Flow 2' });
  await fresh.locator('li p').first().click();
  await page.keyboard.type('dropped C3');
  await fresh.locator('li p').first().click({ clickCount: 3 });
  await page.getByRole('button', { name: 'Dropped', exact: true }).click();
  await expect(fresh.locator('[data-debate-mark="dropped"]')).toHaveText(
    'dropped C3',
  );
  const divider = page.getByRole('separator', { name: 'Resize files' });
  const box = await divider.boundingBox();
  if (!box) throw new Error('The files divider has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + 24);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + 24, { steps: 4 });
  await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', '300');
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '284');
  expect(await violations.read()).toEqual({
    eventViolations: [],
    consoleViolations: [],
  });
});

test('persisted Round workspace has no serious or critical accessibility findings', async ({
  roundFiles,
}) => {
  await assertNoSeriousFindings(roundFiles.page);
  await roundFiles.page.keyboard.press('ControlOrMeta+k');
  await expect(
    roundFiles.page.getByRole('combobox', { name: 'Search commands' }),
  ).toBeFocused();
  await assertNoSeriousFindings(roundFiles.page);
});

test('the participant’s persisted files survive editing and reload', async ({
  roundFiles,
}) => {
  const { page } = roundFiles;
  const violations = await watchCspViolations(page);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`${documentsPath}save`) && response.ok(),
  );
  const flow = page.getByRole('textbox', { name: 'Flow', exact: true });
  await flow.locator('li p').first().click();
  await page.keyboard.type('they dropped the turn');
  await saved;
  expect(await violations.read()).toEqual({
    eventViolations: [],
    consoleViolations: [],
  });
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Files' })
    .getByRole('button', { name: 'Flow', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Flow', exact: true }),
  ).toContainText('they dropped the turn');
});

test('private file rename and stale or cross-account refusal preserve the stored document', async ({
  roundFiles,
}) => {
  const { page, stranger, roundId, documentId } = roundFiles;
  const list = async () => {
    const response = await page.request.post(`${documentsPath}list`, {
      headers: { origin },
      data: { roundId },
    });
    expect(response.status()).toBe(200);
    return response.json();
  };
  const renamed = await page.request.post(`${documentsPath}rename`, {
    headers: { origin },
    data: { id: documentId, title: 'My transit flow' },
  });
  expect(renamed.status()).toBe(200);
  const saved = await page.request.post(`${documentsPath}save`, {
    headers: { origin },
    data: {
      id: documentId,
      html: '<p>Accepted notes</p>',
      expectedRevision: 1,
    },
  });
  expect(saved.status()).toBe(200);
  const before = await list();
  for (const [request, path, data, status] of [
    [stranger, 'list', { roundId }, 404],
    [stranger, 'rename', { id: documentId, title: 'Forbidden' }, 404],
    [
      stranger,
      'save',
      { id: documentId, html: '<p>Forbidden</p>', expectedRevision: 1 },
      404,
    ],
    [
      page.request,
      'save',
      { id: documentId, html: '<p>Stale</p>', expectedRevision: 1 },
      409,
    ],
  ] as const) {
    const response = await request.post(`${documentsPath}${path}`, {
      headers: { origin },
      data,
    });
    expect(response.status()).toBe(status);
    expect(await list()).toEqual(before);
  }
  await page.reload();
  await expect(
    page.getByRole('textbox', { name: 'My transit flow', exact: true }),
  ).toBeVisible();
});
