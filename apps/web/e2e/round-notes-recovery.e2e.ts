import type { Page } from '@playwright/test';
import { openPage } from './support/fixtures';
import { origin } from './support/accounts';
import { documentsPath, expect, test } from './support/round-files';

const draftFor = (page: Page, id: string) =>
  page.evaluate((documentId) => {
    const key = Object.keys(localStorage).find(
      (one) =>
        one.startsWith('daisy:round-notes:draft:') &&
        one.endsWith(`:${documentId}`),
    );
    return key ? JSON.parse(localStorage.getItem(key)!) : null;
  }, id);
const edit = (page: Page, text: string) =>
  page.getByRole('textbox', { name: 'Flow', exact: true }).fill(text);
const serverDocument = async (
  page: Page,
  roundId: string,
  documentId: string,
) => {
  const response = await page.request.post(`${documentsPath}list`, {
    headers: { origin },
    data: { roundId },
  });
  expect(response.status()).toBe(200);
  const { documents } = await response.json();
  return documents.find((one: { id: string }) => one.id === documentId);
};

test('offline edit survives page loss and explicitly restores into the live editor and server', async ({
  roundFiles,
}) => {
  const { page, documentId, roundId } = roundFiles;
  const context = page.context();
  const url = page.url();
  await context.setOffline(true);
  await edit(page, 'Offline recovery text');
  await expect
    .poll(async () => (await draftFor(page, documentId))?.html)
    .toContain('Offline recovery text');
  await page.close();
  await context.setOffline(false);
  const reopened = await openPage(context, 'reopen private Round notes');
  await reopened.goto(url);
  const restore = reopened.getByRole('button', {
    name: 'Restore Flow',
    exact: true,
  });
  await expect(restore).toBeVisible();
  await expect(
    reopened.getByRole('textbox', { name: 'Flow', exact: true }),
  ).not.toContainText('Offline recovery text');
  const saved = reopened.waitForResponse(
    (response) =>
      response.url().endsWith(`${documentsPath}save`) && response.ok(),
  );
  await restore.click();
  await expect(
    reopened.getByRole('textbox', { name: 'Flow', exact: true }),
  ).toContainText('Offline recovery text');
  await saved;
  expect((await serverDocument(reopened, roundId, documentId)).html).toContain(
    'Offline recovery text',
  );
  await expect.poll(() => draftFor(reopened, documentId)).toBeNull();
});

test('newer server copy stays intact until an informed Restore, with copy available', async ({
  roundFiles,
}) => {
  const { page, documentId, roundId } = roundFiles;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await edit(page, 'Local conflict copy');
  await expect
    .poll(async () => (await draftFor(page, documentId))?.html)
    .toContain('Local conflict copy');
  const current = await serverDocument(page, roundId, documentId);
  const saved = await page.request.post(`${documentsPath}save`, {
    headers: { origin },
    data: {
      id: documentId,
      html: '<p>Newer server copy</p>',
      expectedRevision: current.revision,
    },
  });
  expect(saved.status()).toBe(200);
  await page.reload();
  await page.getByText('Compare recovered and server copies').click();
  await expect(page.getByLabel('Recovered copy of Flow')).toContainText(
    'Local conflict copy',
  );
  await expect(page.getByLabel('Server copy of Flow')).toContainText(
    'Newer server copy',
  );
  expect((await serverDocument(page, roundId, documentId)).html).toContain(
    'Newer server copy',
  );
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page
    .getByRole('button', { name: 'Copy recovered Flow', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Copied recovered text.' }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    'Local conflict copy',
  );
  await page.unroute(`**${documentsPath}save`);
  const ack = page.waitForResponse(
    (response) =>
      response.url().endsWith(`${documentsPath}save`) && response.ok(),
  );
  await page.getByRole('button', { name: 'Restore Flow', exact: true }).click();
  await ack;
  expect((await serverDocument(page, roundId, documentId)).html).toContain(
    'Local conflict copy',
  );
});

test('Discard of a recovery offer preserves newer editor typing', async ({
  roundFiles,
}) => {
  const { page, documentId, roundId } = roundFiles;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await edit(page, 'Old recovered choice');
  await expect.poll(() => draftFor(page, documentId)).not.toBeNull();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Discard recovered Flow', exact: true }),
  ).toBeVisible();
  await edit(page, 'Newer typing survives discard');
  await page
    .getByRole('button', { name: 'Discard recovered Flow', exact: true })
    .click();
  expect((await draftFor(page, documentId)).html).toContain(
    'Newer typing survives discard',
  );
  await page.unroute(`**${documentsPath}save`);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect
    .poll(async () => (await serverDocument(page, roundId, documentId)).html)
    .toContain('Newer typing survives discard');
});

test('lost acknowledgement keeps newer typed notes through reload and explicit reconciliation', async ({
  roundFiles,
}) => {
  const { page, roundId, documentId } = roundFiles;
  let committed = false;
  await page.route(`**${documentsPath}save`, async (route) => {
    if (!committed) {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      committed = true;
    }
    await route.abort();
  });
  await edit(page, 'Acknowledgement lost A');
  await expect.poll(() => committed).toBe(true);
  await edit(page, 'Newer B after lost acknowledgement');
  await expect
    .poll(async () => (await draftFor(page, documentId))?.html)
    .toContain('Newer B');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Restore Flow', exact: true }),
  ).toBeVisible();
  expect((await serverDocument(page, roundId, documentId)).html).toContain(
    'Acknowledgement lost A',
  );
  await page.unroute(`**${documentsPath}save`);
  await page.getByRole('button', { name: 'Restore Flow', exact: true }).click();
  await expect
    .poll(async () => (await serverDocument(page, roundId, documentId)).html)
    .toContain('Newer B after lost acknowledgement');
});

test('unavailable browser storage warns while real online saves continue', async ({
  roundFiles,
}) => {
  const { page, documentId, roundId } = roundFiles;
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('daisy:round-notes:draft:'))
        throw new DOMException('Denied', 'QuotaExceededError');
      return write.call(this, key, value);
    };
  });
  await edit(page, 'Online despite unavailable recovery');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Storage is unavailable' }),
  ).toBeVisible();
  await expect
    .poll(async () => (await serverDocument(page, roundId, documentId)).html)
    .toContain('Online despite unavailable recovery');
});

test('native logout erases recovery and a stale tab cannot recreate it', async ({
  roundFiles,
}) => {
  await roundFiles.finishRound();
  const { page, documentId } = roundFiles;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await edit(page, 'Private pending notes before logout');
  await expect.poll(() => draftFor(page, documentId)).not.toBeNull();
  const shell = await openPage(
    page.context(),
    'native sign-out for Round notes',
  );
  await shell.goto(`${origin}/settings`);
  await shell.getByLabel(/^Your account,/).click();
  await shell.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(shell).toHaveURL(/\/sign-in/);
  await expect.poll(() => draftFor(page, documentId)).toBeNull();
  await edit(page, 'Stale tab after logout');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect(await draftFor(page, documentId)).toBeNull();
});

test('observed session revocation purges private notes and fences further editing', async ({
  roundFiles,
}) => {
  await roundFiles.finishRound();
  const { page, documentId } = roundFiles;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await edit(page, 'Pending notes before revocation');
  await expect.poll(() => draftFor(page, documentId)).not.toBeNull();
  const revoked = await page.request.post('/api/auth/revoke-sessions', {
    headers: { origin },
    data: {},
  });
  expect(revoked.status()).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => draftFor(page, documentId)).toBeNull();
  await expect(
    page.getByRole('textbox', { name: 'Flow', exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect(await draftFor(page, documentId)).toBeNull();
});

test('account switch purges old-principal recovery across tabs without revealing it to the next member', async ({
  roundFiles,
}) => {
  const { page, documentId, stranger } = roundFiles;
  await roundFiles.finishRound();
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await edit(page, 'Private notes from the former account');
  await expect.poll(() => draftFor(page, documentId)).not.toBeNull();
  const state = await stranger.storageState();
  await page.context().clearCookies();
  await page.context().addCookies(state.cookies);
  const nextAccount = await openPage(
    page.context(),
    'next-account Round note isolation',
  );
  await nextAccount.goto(`${origin}/settings`);
  await expect.poll(() => draftFor(page, documentId)).toBeNull();
  await expect(
    nextAccount.getByRole('button', { name: /Restore/ }),
  ).toHaveCount(0);
  await expect(nextAccount.locator('body')).not.toContainText(
    'Private notes from the former account',
  );
  await expect(
    page.getByRole('textbox', { name: 'Flow', exact: true }),
  ).toHaveCount(0);
});

test('multibyte multi-document exit keeps overflow recoverable and each choice targets its own file', async ({
  roundFiles,
}) => {
  const { page, roundId, documentId } = roundFiles;
  const created = await page.request.post(`${documentsPath}create`, {
    headers: { origin },
    data: { roundId, folder: 'round', templateId: 'flow' },
  });
  expect(created.status()).toBe(201);
  const { document: second } = await created.json();
  await page.reload();
  await expect(
    page.getByRole('textbox', { name: 'Flow', exact: true }),
  ).toBeVisible();
  await page.clock.install({ time: '2026-11-01T18:00:00Z' });
  await page.clock.pauseAt('2026-11-01T18:01:00Z');
  const bodies: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${documentsPath}save`, async (route) => {
    bodies.push(route.request().postData()!);
    await gate;
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  await edit(page, '界'.repeat(14000));
  await page
    .getByRole('navigation', { name: 'Files' })
    .getByRole('button', { name: second.title, exact: true })
    .click();
  await page
    .getByRole('textbox', { name: second.title, exact: true })
    .fill('語'.repeat(14000));
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(() => bodies.length).toBe(1);
  expect(
    bodies.reduce(
      (sum, body) => sum + new TextEncoder().encode(body).length,
      0,
    ),
  ).toBeLessThanOrEqual(65536);
  expect((await draftFor(page, documentId)).html).toContain('界');
  expect((await draftFor(page, second.id)).html).toContain('語');
  release();
  await expect
    .poll(async () => (await serverDocument(page, roundId, documentId)).html)
    .toContain('界');
  await page.unroute(`**${documentsPath}save`);
  await page.clock.resume();
  await page.reload();
  await expect(
    page.getByRole('button', { name: `Restore ${second.title}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Restore Flow', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: `Restore ${second.title}`, exact: true })
    .click();
  await expect
    .poll(async () => (await serverDocument(page, roundId, second.id)).html)
    .toContain('語');
  expect((await serverDocument(page, roundId, documentId)).html).toContain(
    '界',
  );
});
