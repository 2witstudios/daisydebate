import type { Page } from '@playwright/test';
import { openPage } from './support/fixtures';
import { origin } from './support/accounts';
import { profileLink } from './support/shell-links';
import {
  createRoundFile,
  createFinishedRoundFile,
  documentsPath,
  expect,
  test,
} from './support/round-files';

const rawDraftFor = (page: Page, id: string) =>
  page.evaluate((documentId) => {
    const key = Object.keys(localStorage).find(
      (one) =>
        one.startsWith('daisy:round-notes:draft:') &&
        one.endsWith(`:${documentId}`),
    );
    return key ? localStorage.getItem(key) : null;
  }, id);
const draftFor = async (page: Page, id: string) => {
  const raw = await rawDraftFor(page, id);
  return raw === null ? null : JSON.parse(raw);
};
const edit = (page: Page, text: string) =>
  page.getByRole('textbox', { name: 'Flow', exact: true }).fill(text);
/**
 * A failure double for one case only: the exit save never reaches the server.
 * A real unload keepalive gets past a routed abort and offline emulation, so the
 * page's own request fails instead. This proves recovery after a lost save, not
 * that browsers lose one. The real commit has its own journey with no double.
 */
const reloadLosingExitSave = async (page: Page) => {
  await page.evaluate((save) => {
    const send = window.fetch;
    const mark = (outcome: string) =>
      sessionStorage.setItem(
        `exit-save-double:${outcome}`,
        String(
          Number(sessionStorage.getItem(`exit-save-double:${outcome}`)) + 1,
        ),
      );
    Reflect.set(window, 'fetch', (...request: Parameters<typeof send>) => {
      const [input, init] = request;
      if (String(input) !== save) return send(...request);
      if (init?.method !== 'POST' || init.keepalive !== true) {
        mark('unexpected');
        return send(...request);
      }
      mark('lost');
      return Promise.reject(new TypeError('Failed to fetch'));
    });
  }, `${documentsPath}save`);
  await page.reload();
  const outcome = await page.evaluate(() => {
    const read = (name: string) =>
      Number(sessionStorage.getItem(`exit-save-double:${name}`));
    const seen = { lost: read('lost'), unexpected: read('unexpected') };
    sessionStorage.removeItem('exit-save-double:lost');
    sessionStorage.removeItem('exit-save-double:unexpected');
    return seen;
  });
  expect(outcome.unexpected).toBe(0);
  expect(outcome.lost).toBeGreaterThan(0);
};
/** Wait for the actual offer before sampling its independent durable identity. */
const offeredAfterReload = async (
  page: Page,
  documentId: string,
  text: string,
  reload: (page: Page) => Promise<unknown> = reloadLosingExitSave,
) => {
  await edit(page, text);
  await expect
    .poll(async () =>
      (await draftFor(page, documentId))?.active?.html.includes(text),
    )
    .toBe(true);
  await reload(page);
  await expect(
    page.getByRole('button', { name: 'Restore Flow', exact: true }),
  ).toBeVisible();
  const recovery = (await draftFor(page, documentId)).recovery;
  expect(recovery.generation).toMatch(/^[a-z0-9]{24}$/);
  expect(recovery.html).toContain(text);
  return recovery;
};
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

/** A finished second Round holding its own offered recovery, with saves still aborted. */
const secondRoundWithRecovery = async ({
  page,
  finishRound,
}: {
  readonly page: Page;
  readonly finishRound: () => Promise<void>;
}) => {
  await finishRound();
  const second = await createFinishedRoundFile(page);
  const identity = await page.request.get('/api/auth/get-session');
  expect(identity.status()).toBe(200);
  const { user } = (await identity.json()) as {
    user: { id: string; username: string };
  };
  await openFlow(page, second.roundId);
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  const secondRecovery = await offeredAfterReload(
    page,
    second.documentId,
    'Second Round REC',
  );
  return { second, user, secondRecovery };
};
const openFlow = async (page: Page, roundId: string) => {
  await page.goto(`${origin}/rounds/${roundId}`);
  await expect(
    page.getByRole('textbox', { name: 'Flow', exact: true }),
  ).toBeVisible();
};
/** The HTML of every save this page sends for one document. */
const recordSavedHtml = (page: Page, documentId: string) => {
  const sends: string[] = [];
  page.on('request', (request) => {
    if (!request.url().endsWith(`${documentsPath}save`)) return;
    const body = request.postDataJSON() as { id: string; html: string };
    if (body.id === documentId) sends.push(body.html);
  });
  return sends;
};
const typePendingEdit = async (
  page: Page,
  documentId: string,
  text: string,
) => {
  await edit(page, text);
  expect((await draftFor(page, documentId)).active.html).toContain(text);
};
/** The other Round shows only its own offer, never the Round just left. */
const expectSecondRoundOffer = async (page: Page) => {
  await expect(
    page.getByRole('button', { name: 'Restore Flow', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Flow', exact: true }),
  ).not.toContainText('First Round pending NEW');
  await page.getByText('Compare recovered and server copies').click();
  await expect(page.getByLabel('Recovered copy of Flow')).toContainText(
    'Second Round REC',
  );
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
    .poll(async () => (await draftFor(page, documentId))?.active?.html)
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
}, testInfo) => {
  const { page, documentId, roundId } = roundFiles;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await edit(page, 'Local conflict copy');
  await expect
    .poll(async () => (await draftFor(page, documentId))?.active?.html)
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
  await page
    .context()
    .grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  expect(
    await page.evaluate(async () =>
      Promise.all(
        ['camera', 'microphone', 'clipboard-read', 'clipboard-write'].map(
          async (name) =>
            (
              await navigator.permissions.query({
                name: name as PermissionName,
              })
            ).state,
        ),
      ),
    ),
  ).toEqual(['granted', 'granted', 'granted', 'granted']);
  // Observe the real browser API; preserve both success and rejection. This
  // allowlisted diagnostic contains no clipboard text, HTML, keys or identity.
  await page.evaluate(() => {
    const clipboard = navigator.clipboard;
    const write = clipboard.writeText.bind(clipboard);
    clipboard.writeText = async (text: string) => {
      const observed = {
        secure: window.isSecureContext,
        focused: document.hasFocus(),
        activated: navigator.userActivation.isActive,
        result: 'pending',
      };
      Reflect.set(window, '__notesClipboard', observed);
      try {
        await write(text);
        observed.result = 'written';
      } catch (error: unknown) {
        const name = error instanceof Error ? error.name : '';
        observed.result = [
          'NotAllowedError',
          'SecurityError',
          'TypeError',
          'AbortError',
        ].includes(name)
          ? name
          : 'other-rejection';
        throw error;
      }
    };
  });
  await page
    .getByRole('button', { name: 'Copy recovered Flow', exact: true })
    .click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /Copied recovered text\.|Copy was unavailable\./ }),
  ).toBeVisible();
  await testInfo.attach('clipboard-operation', {
    body: JSON.stringify(
      await page.evaluate(() => Reflect.get(window, '__notesClipboard')),
    ),
    contentType: 'application/json',
  });
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

test('after a lost exit save, Discard of a recovery offer preserves newer editor typing', async ({
  roundFiles,
}) => {
  const { page, documentId, roundId } = roundFiles;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await edit(page, 'Old recovered choice');
  await expect.poll(() => draftFor(page, documentId)).not.toBeNull();
  await reloadLosingExitSave(page);
  await expect(
    page.getByRole('button', { name: 'Discard recovered Flow', exact: true }),
  ).toBeVisible();
  await edit(page, 'Newer typing survives discard');
  await page
    .getByRole('button', { name: 'Discard recovered Flow', exact: true })
    .click();
  expect((await draftFor(page, documentId)).active.html).toContain(
    'Newer typing survives discard',
  );
  await page.unroute(`**${documentsPath}save`);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect
    .poll(async () => (await serverDocument(page, roundId, documentId)).html)
    .toContain('Newer typing survives discard');
});

test('after a lost exit save, Discard removes the recovered copy so neither page exit nor reload brings it back', async ({
  roundFiles,
}) => {
  const { page, documentId, roundId } = roundFiles;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await offeredAfterReload(page, documentId, 'Discarded private text');
  await page.unroute(`**${documentsPath}save`);
  const server = await serverDocument(page, roundId, documentId);
  const sends: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith(`${documentsPath}save`))
      sends.push(request.postData() ?? '');
  });
  await page
    .getByRole('button', { name: 'Discard recovered Flow', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Restore Flow', exact: true }),
  ).toBeHidden();
  expect(await rawDraftFor(page, documentId)).toBeNull();
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide')),
  );
  await page.reload();
  await expect(
    page.getByRole('textbox', { name: 'Flow', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Restore Flow', exact: true }),
  ).toBeHidden();
  expect(sends).toEqual([]);
  expect(await serverDocument(page, roundId, documentId)).toEqual(server);
});

test('a real exit save with no failure double commits once and leaves no false recovery offer', async ({
  roundFiles,
}) => {
  const { page, roundId, documentId } = roundFiles;
  const start = await serverDocument(page, roundId, documentId);
  // A paused page clock holds the debounce, so only the exit can send this edit.
  await page.clock.install({ time: '2026-11-01T18:00:00Z' });
  await page.clock.pauseAt('2026-11-01T18:01:00Z');
  await typePendingEdit(page, documentId, 'Committed by the real exit');
  await page.reload();
  await expect
    .poll(
      async () => (await serverDocument(page, roundId, documentId)).revision,
    )
    .toBe(start.revision + 1);
  await expect(
    page.getByRole('textbox', { name: 'Flow', exact: true }),
  ).toContainText('Committed by the real exit');
  await expect(
    page.getByRole('button', { name: 'Restore Flow', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('An unsaved draft is available')).toHaveCount(0);
  await expect.poll(() => rawDraftFor(page, documentId)).toBeNull();
  expect((await serverDocument(page, roundId, documentId)).revision).toBe(
    start.revision + 1,
  );
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
    .poll(async () => (await draftFor(page, documentId))?.active?.html)
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
  await page.clock.install();
  let loggedOut = false,
    lateSends = 0;
  await page.route(`**${documentsPath}save`, (route) => {
    if (loggedOut) lateSends++;
    return route.abort();
  });
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
  loggedOut = true;
  await expect(
    page.getByRole('textbox', { name: 'Flow', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(
    'Private pending notes before logout',
  );
  await page.clock.runFor(30_000);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect(await draftFor(page, documentId)).toBeNull();
  expect(lateSends).toBe(0);
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

test('multibyte multi-document exit keeps overflow recoverable after a lost exit save and each choice targets its own file', async ({
  roundFiles,
}) => {
  const { page, roundId, documentId } = roundFiles;
  const second = await createRoundFile(page.request, roundId);
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
  expect((await draftFor(page, documentId)).active.html).toContain('界');
  expect((await draftFor(page, second.id)).active.html).toContain('語');
  release();
  await expect
    .poll(async () => (await serverDocument(page, roundId, documentId)).html)
    .toContain('界');
  await page.unroute(`**${documentsPath}save`);
  await page.clock.resume();
  await reloadLosingExitSave(page);
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

test('the Round receipt visibly restores a private draft through the same sync owner', async ({
  roundFiles,
}) => {
  const { page, roundId, documentId } = roundFiles;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await edit(page, 'Receipt recovery text');
  await expect.poll(() => draftFor(page, documentId)).not.toBeNull();
  await roundFiles.finishRound();
  await page.goto(`${origin}/rounds/${roundId}`);
  const files = page.getByRole('region', { name: 'Your Round files' });
  await expect(
    files.getByRole('button', { name: 'Restore Flow', exact: true }),
  ).toBeVisible();
  await expect(
    files.getByRole('textbox', { name: 'Flow', exact: true }),
  ).not.toContainText('Receipt recovery text');
  await page.unroute(`**${documentsPath}save`);
  await files
    .getByRole('button', { name: 'Restore Flow', exact: true })
    .click();
  await expect(
    files.getByRole('textbox', { name: 'Flow', exact: true }),
  ).toContainText('Receipt recovery text');
  await expect
    .poll(async () => (await serverDocument(page, roundId, documentId)).html)
    .toContain('Receipt recovery text');
  await expect.poll(() => draftFor(page, documentId)).toBeNull();
});

test('actual deferred A acknowledgement rebases B and leaves it unsaved until its own acknowledgement', async ({
  roundFiles,
}) => {
  const { page, roundId, documentId } = roundFiles;
  const a = Promise.withResolvers<void>(),
    b = Promise.withResolvers<void>();
  let requests = 0;
  const original = await serverDocument(page, roundId, documentId);
  await page.route(`**${documentsPath}save`, async (route) => {
    const index = ++requests;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await (index === 1 ? a.promise : b.promise);
    await route.fulfill({ response });
  });
  try {
    await edit(page, 'Deferred A');
    await expect.poll(() => requests).toBe(1);
    await edit(page, 'Newer B while A awaits acknowledgement');
    a.resolve();
    await expect.poll(() => requests).toBe(2);
    const durable = await draftFor(page, documentId);
    expect(durable.active.html).toContain(
      'Newer B while A awaits acknowledgement',
    );
    expect(durable.active.baseRevision).toBe(original.revision + 1);
    await expect(page.getByText('Saved', { exact: true })).toHaveCount(0);
    b.resolve();
    await expect.poll(() => draftFor(page, documentId)).toBeNull();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    expect((await serverDocument(page, roundId, documentId)).html).toContain(
      'Newer B while A awaits acknowledgement',
    );
  } finally {
    a.resolve();
    b.resolve();
    await page.unroute(`**${documentsPath}save`);
  }
});

test('two real editor tabs preserve a stale conflict until explicit recovery', async ({
  roundFiles,
}) => {
  const { page, roundId, documentId } = roundFiles;
  const other = await openPage(
    page.context(),
    'concurrent private-note editor',
  );
  await other.goto(page.url());
  await expect(
    other.getByRole('textbox', { name: 'Flow', exact: true }),
  ).toBeVisible();
  const accepted = page.waitForResponse(
    (response) =>
      response.url().endsWith(`${documentsPath}save`) && response.ok(),
  );
  await edit(page, 'Accepted first-tab text');
  await accepted;
  await edit(other, 'Conflicting second-tab text');
  await expect(
    other
      .getByRole('alert')
      .filter({ hasText: 'This file changed in another tab.' }),
  ).toBeVisible();
  expect((await serverDocument(page, roundId, documentId)).html).toContain(
    'Accepted first-tab text',
  );
  expect((await draftFor(other, documentId)).active.html).toContain(
    'Conflicting second-tab text',
  );
  await other.reload();
  await expect(
    other.getByRole('button', { name: 'Restore Flow', exact: true }),
  ).toBeVisible();
  await expect(
    other.getByRole('textbox', { name: 'Flow', exact: true }),
  ).toContainText('Accepted first-tab text');
  await other
    .getByRole('button', { name: 'Restore Flow', exact: true })
    .click();
  await expect
    .poll(async () => (await serverDocument(other, roundId, documentId)).html)
    .toContain('Conflicting second-tab text');
  await expect.poll(() => draftFor(other, documentId)).toBeNull();
});

for (const reloadBeforeRestore of [false, true])
  test(`after a lost exit save, recovery survives newer typing and acknowledgement${reloadBeforeRestore ? ' and another reload' : ''} before explicit Restore`, async ({
    roundFiles,
  }) => {
    const { page, documentId, roundId } = roundFiles;
    await page.route(`**${documentsPath}save`, (route) => route.abort());
    const recovery = await offeredAfterReload(
      page,
      documentId,
      'Independent REC',
    );
    await page.unroute(`**${documentsPath}save`);
    await edit(page, 'Acknowledged NEW');
    await expect
      .poll(async () => (await serverDocument(page, roundId, documentId)).html)
      .toContain('Acknowledged NEW');
    await expect
      .poll(async () => (await draftFor(page, documentId))?.active)
      .toBeUndefined();
    expect((await draftFor(page, documentId)).recovery).toEqual(recovery);
    if (reloadBeforeRestore) await page.reload();
    await expect(
      page.getByRole('button', { name: 'Restore Flow', exact: true }),
    ).toBeVisible();
    expect((await draftFor(page, documentId)).recovery).toEqual(recovery);
    expect((await serverDocument(page, roundId, documentId)).html).toContain(
      'Acknowledged NEW',
    );
    await page
      .getByRole('button', { name: 'Restore Flow', exact: true })
      .click();
    await expect(
      page.getByRole('textbox', { name: 'Flow', exact: true }),
    ).toContainText('Independent REC');
    await expect
      .poll(async () => (await serverDocument(page, roundId, documentId)).html)
      .toContain('Independent REC');
    await expect.poll(() => draftFor(page, documentId)).toBeNull();
  });

test('after a lost exit save, Restore over pending NEW keeps NEW as an independent durable offer after REC saves', async ({
  roundFiles,
}) => {
  const { page, documentId, roundId } = roundFiles;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await edit(page, 'REC for swap');
  await expect
    .poll(async () => (await draftFor(page, documentId))?.active?.html)
    .toContain('REC for swap');
  await reloadLosingExitSave(page);
  await expect(
    page.getByRole('button', { name: 'Restore Flow', exact: true }),
  ).toBeVisible();
  await edit(page, 'Pending NEW for swap');
  await expect
    .poll(async () => (await draftFor(page, documentId))?.active?.html)
    .toContain('Pending NEW for swap');
  const pending = (await draftFor(page, documentId)).active;
  await page.getByRole('button', { name: 'Restore Flow', exact: true }).click();
  expect((await draftFor(page, documentId)).recovery).toEqual(pending);
  await page.unroute(`**${documentsPath}save`);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide')),
  );
  await expect
    .poll(async () => (await serverDocument(page, roundId, documentId)).html)
    .toContain('REC for swap');
  expect((await draftFor(page, documentId)).recovery).toEqual(pending);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Restore Flow', exact: true }),
  ).toBeVisible();
  await page.getByText('Compare recovered and server copies').click();
  await expect(page.getByLabel('Recovered copy of Flow')).toContainText(
    'Pending NEW for swap',
  );
});

test('after a lost exit save, denied clipboard permission exposes selectable recovered text without consuming the offer', async ({
  roundFiles,
}) => {
  const { page, documentId } = roundFiles;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await edit(page, 'Manual recovery copy');
  await expect
    .poll(async () => (await draftFor(page, documentId))?.active?.html)
    .toContain('Manual recovery copy');
  await reloadLosingExitSave(page);
  await expect(
    page.getByRole('button', { name: 'Copy recovered Flow', exact: true }),
  ).toBeVisible();
  const before = (await draftFor(page, documentId)).recovery;
  const session = await page.context().newCDPSession(page);
  try {
    const { targetInfo } = await session.send('Target.getTargetInfo');
    if (!targetInfo.browserContextId)
      throw new Error(
        'An isolated context is required for a clipboard denial proof.',
      );
    // Explicit denial is scoped to this isolated context and this origin.
    // Both clipboard permission forms are denied; no grant or API stub is used.
    for (const allowWithoutSanitization of [false, true])
      await session.send('Browser.setPermission', {
        permission: { name: 'clipboard-write', allowWithoutSanitization },
        setting: 'denied',
        origin: new URL(page.url()).origin,
        browserContextId: targetInfo.browserContextId,
      });
    await page
      .getByRole('button', { name: 'Copy recovered Flow', exact: true })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Copy was unavailable' }),
    ).toBeVisible();
    const manual = page.getByRole('textbox', {
      name: 'Recovered text to copy from Flow',
      exact: true,
    });
    await expect(manual).toHaveValue('Manual recovery copy');
    await manual.focus();
    expect(
      await manual.evaluate((element) => {
        const textarea = element as HTMLTextAreaElement;
        return textarea.value.slice(
          textarea.selectionStart,
          textarea.selectionEnd,
        );
      }),
    ).toBe('Manual recovery copy');
    expect((await draftFor(page, documentId)).recovery).toEqual(before);
    await expect(
      page.getByRole('button', { name: 'Restore Flow', exact: true }),
    ).toBeVisible();
  } finally {
    await session.detach();
  }
});

for (const refusal of ['denied storage', 'combined overflow'] as const)
  test(`${refusal === 'denied storage' ? 'after a lost exit save, denied storage' : 'a real exit with an edit over the budget stays unsent and combined overflow'} preserves the recovery offer and current editor while NEW still saves online`, async ({
    roundFiles,
  }) => {
    const { page, documentId, roundId } = roundFiles;
    const rec =
      refusal === 'combined overflow' ? 'R'.repeat(140_000) : 'Retained REC';
    const next =
      refusal === 'combined overflow' ? 'N'.repeat(140_000) : 'Pending NEW';
    await page.route(`**${documentsPath}save`, (route) => route.abort());
    // 140 KB is over the 64 KiB exit budget, so no exit save is even attempted.
    const recovery = await offeredAfterReload(
      page,
      documentId,
      rec,
      refusal === 'combined overflow'
        ? (target) => target.reload()
        : reloadLosingExitSave,
    );
    if (refusal === 'combined overflow')
      expect(
        (await serverDocument(page, roundId, documentId)).html,
      ).not.toContain(rec);
    await page.unroute(`**${documentsPath}save`);
    const gate = Promise.withResolvers<void>();
    let arrived = false;
    await page.route(`**${documentsPath}save`, async (route) => {
      const body = route.request().postDataJSON() as { html: string };
      if (body.html.includes(next)) {
        arrived = true;
        await gate.promise;
      }
      const response = await route.fetch();
      await route.fulfill({ response });
    });
    if (refusal === 'denied storage')
      await page.evaluate(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key.startsWith('daisy:round-notes:draft:'))
            throw new DOMException('Denied', 'QuotaExceededError');
          set.call(this, key, value);
        };
      });
    try {
      await edit(page, next);
      await expect.poll(() => arrived).toBe(true);
      const beforeRestore = await rawDraftFor(page, documentId);
      expect(beforeRestore).not.toBeNull();
      const previous = JSON.parse(beforeRestore!);
      expect(previous.recovery).toEqual(recovery);
      expect(previous.active?.html ?? '').not.toContain(next);
      await page
        .getByRole('button', { name: 'Restore Flow', exact: true })
        .click();
      await expect(
        page.getByRole('textbox', { name: 'Flow', exact: true }),
      ).toContainText(next);
      expect((await draftFor(page, documentId)).recovery).toEqual(recovery);
      expect(await rawDraftFor(page, documentId)).toBe(beforeRestore);
      await expect(
        page.getByRole('alert').filter({ hasText: 'Storage is unavailable' }),
      ).toBeVisible();
      gate.resolve();
      await expect
        .poll(async () =>
          (await serverDocument(page, roundId, documentId)).html.includes(next),
        )
        .toBe(true);
      expect((await draftFor(page, documentId)).recovery).toEqual(recovery);
      await expect(
        page.getByRole('button', { name: 'Restore Flow', exact: true }),
      ).toBeVisible();
    } finally {
      gate.resolve();
    }
  });

test('after a lost exit save, Server copy comparison keeps showing the server text while newer typing is unsaved', async ({
  roundFiles,
}) => {
  const { page, roundId, documentId } = roundFiles;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await offeredAfterReload(page, documentId, 'Offered REC');
  const server = await serverDocument(page, roundId, documentId);
  expect(server.html).not.toContain('Unsaved NEW');
  await edit(page, 'Unsaved NEW');
  await page.getByText('Compare recovered and server copies').click();
  await expect(page.getByLabel('Recovered copy of Flow')).toContainText(
    'Offered REC',
  );
  await expect(page.getByLabel('Server copy of Flow')).not.toContainText(
    'Unsaved NEW',
  );
  expect((await serverDocument(page, roundId, documentId)).html).toBe(
    server.html,
  );
});

test('after lost exit saves, original copy expiry withdraws only that offer while later swapped recovery survives reload', async ({
  roundFiles,
}) => {
  const { page, roundId, documentId } = roundFiles;
  await roundFiles.finishRound();
  await openFlow(page, roundId);
  const { revision: startRevision } = await serverDocument(
    page,
    roundId,
    documentId,
  );
  const revisionTrail: Record<string, number> = {};
  const noteRevision = async (step: string) => {
    revisionTrail[step] = (
      await serverDocument(page, roundId, documentId)
    ).revision;
  };
  await page.clock.install();
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  const recovery = await offeredAfterReload(
    page,
    documentId,
    'Original expiring REC',
  );
  await noteRevision('after first reload');
  await page.clock.setSystemTime(new Date(recovery.savedAt + 60_000));
  await edit(page, 'Later independent NEW');
  const beforeSwap = await draftFor(page, documentId);
  expect(beforeSwap.recovery).toEqual(recovery);
  const active = beforeSwap.active;
  expect(active.generation).toMatch(/^[a-z0-9]{24}$/);
  expect(active.html).toContain('Later independent NEW');
  expect(active.savedAt).toBeGreaterThan(recovery.savedAt);
  await page.getByRole('button', { name: 'Restore Flow', exact: true }).click();
  const swapped = await draftFor(page, documentId);
  await noteRevision('after Restore');
  expect(swapped.recovery).toEqual(active);
  expect(swapped.active.generation).toMatch(/^[a-z0-9]{24}$/);
  expect(swapped.active.generation).not.toBe(recovery.generation);
  expect(swapped.active.generation).not.toBe(active.generation);
  expect(swapped.active.savedAt).toBe(recovery.savedAt);
  expect(swapped.active.expiresAt).toBe(recovery.expiresAt);
  expect(swapped.active.html).toBe(recovery.html);
  await page.clock.setSystemTime(new Date(recovery.expiresAt));
  await reloadLosingExitSave(page);
  await expect(
    page.getByRole('button', { name: 'Restore Flow', exact: true }),
  ).toBeVisible();
  expect(await draftFor(page, documentId)).toEqual({ recovery: active });
  await noteRevision('after second reload');
  // No save, ordinary or at exit, reached the server through this journey.
  expect(revisionTrail).toEqual({
    'after first reload': startRevision,
    'after Restore': startRevision,
    'after second reload': startRevision,
  });
  await page.getByText('Compare recovered and server copies').click();
  await expect(page.getByLabel('Recovered copy of Flow')).toContainText(
    'Later independent NEW',
  );
  await expect(
    page.getByRole('region', { name: 'Recovered Flow', exact: true }),
  ).not.toContainText('Original expiring REC');
});

test('controlled router-lifecycle proof, not end-user navigation: Round replacement flushes pending notes without purging either Round recovery, the other Round seeded by a lost exit save', async ({
  roundFiles,
}) => {
  const { page, roundId, documentId } = roundFiles;
  const { second, user, secondRecovery } =
    await secondRoundWithRecovery(roundFiles);
  const principalId = user.id;
  expect(principalId).toMatch(/^[a-z0-9]{24}$/);
  await openFlow(page, roundId);
  const firstRecovery = await offeredAfterReload(
    page,
    documentId,
    'First Round REC',
  );
  const scopes = await page.evaluate(
    ({ principalId, roundId, documentId, second }) => {
      const firstKey = `daisy:round-notes:draft:${principalId}:${roundId}:${documentId}`;
      const secondKey = `daisy:round-notes:draft:${principalId}:${second.roundId}:${second.documentId}`;
      return [
        localStorage.getItem(firstKey),
        localStorage.getItem(secondKey),
      ].map((raw) => (raw === null ? null : JSON.parse(raw)));
    },
    { principalId, roundId, documentId, second },
  );
  expect(scopes).toEqual([
    { recovery: firstRecovery },
    { recovery: secondRecovery },
  ]);
  const sends = recordSavedHtml(page, documentId);
  await page.unroute(`**${documentsPath}save`);
  await page.clock.install({ time: new Date(firstRecovery.savedAt + 1_000) });
  await page.clock.pauseAt(new Date(firstRecovery.savedAt + 2_000));
  await page.evaluate(() =>
    Reflect.set(window, '__notesRoundNavigation', 'same-browser-owner'),
  );
  await typePendingEdit(page, documentId, 'First Round pending NEW');
  // Next exposes its actual public AppRouter instance for browser diagnostics.
  // Exercise its production route transition without adding a test bridge to the app.
  await page.evaluate((href) => {
    const next = Reflect.get(window, 'next') as {
      router: { push: (href: string) => void };
    };
    next.router.push(href);
  }, `/rounds/${second.roundId}`);
  await expect(page).toHaveURL(`${origin}/rounds/${second.roundId}`);
  expect(
    await page.evaluate(() => Reflect.get(window, '__notesRoundNavigation')),
  ).toBe('same-browser-owner');
  await expect
    .poll(async () => (await serverDocument(page, roundId, documentId)).html)
    .toContain('First Round pending NEW');
  expect(await draftFor(page, documentId)).toEqual({ recovery: firstRecovery });
  expect(await draftFor(page, second.documentId)).toEqual({
    recovery: secondRecovery,
  });
  await expectSecondRoundOffer(page);
  expect(sends).toHaveLength(1);
  expect(sends[0]).toContain('First Round pending NEW');
  await page.clock.runFor(30_000);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide')),
  );
  expect(sends).toHaveLength(1);
  expect(await draftFor(page, documentId)).toEqual({ recovery: firstRecovery });
  expect(await draftFor(page, second.documentId)).toEqual({
    recovery: secondRecovery,
  });
});

test('end-user navigation: leaving a Round through the account menu saves pending notes and browser Back returns through both Rounds via the profile page, the other Round seeded by a lost exit save', async ({
  roundFiles,
}) => {
  const { page, roundId, documentId } = roundFiles;
  const { second, user, secondRecovery } =
    await secondRoundWithRecovery(roundFiles);
  const { username } = user;
  await page.unroute(`**${documentsPath}save`);
  await openFlow(page, roundId);
  const sends = recordSavedHtml(page, documentId);
  // A paused page clock holds the debounce, so only leaving can send this edit.
  await page.clock.install({ time: new Date(secondRecovery.savedAt + 1_000) });
  await page.clock.pauseAt(new Date(secondRecovery.savedAt + 2_000));
  await typePendingEdit(page, documentId, 'First Round pending NEW');
  await (await profileLink(page, username)).click();
  await expect(page).toHaveURL(`${origin}/profile/${username}`);
  await expect
    .poll(async () => (await serverDocument(page, roundId, documentId)).html)
    .toContain('First Round pending NEW');
  await expect.poll(() => draftFor(page, documentId)).toBeNull();
  await page.goBack();
  await expect(page).toHaveURL(`${origin}/rounds/${roundId}`);
  await expect(
    page.getByRole('textbox', { name: 'Flow', exact: true }),
  ).toContainText('First Round pending NEW');
  await expect(
    page.getByRole('button', { name: 'Restore Flow', exact: true }),
  ).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(`${origin}/rounds/${second.roundId}`);
  await expectSecondRoundOffer(page);
  expect(sends).toHaveLength(1);
  expect(await draftFor(page, second.documentId)).toEqual({
    recovery: secondRecovery,
  });
});
