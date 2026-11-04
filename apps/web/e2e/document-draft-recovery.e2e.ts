import type { Page } from '@playwright/test';
import { openPage } from './support/fixtures';
import { origin } from './support/accounts';
import { profileLink } from './support/shell-links';
import {
  createMemberDocument,
  documentFromFinishedRound,
  documentsPath,
  expect,
  test,
} from './support/live-room-documents';

const rawDraftFor = (page: Page, id: string) =>
  page.evaluate((documentId) => {
    const key = Object.keys(localStorage).find(
      (one) =>
        one.startsWith('daisy:document-drafts:copy:') &&
        one.endsWith(`:${documentId}`),
    );
    return key ? localStorage.getItem(key) : null;
  }, id);
const draftFor = async (page: Page, id: string) => {
  const raw = await rawDraftFor(page, id);
  return raw === null ? null : JSON.parse(raw);
};
/** A person's documents are numbered across every Round, and one editor shows. */
const untitled = /^Untitled( \d+)?$/;
const edit = (page: Page, text: string) =>
  page.getByRole('textbox', { name: untitled }).fill(text);
/**
 * A failure double for one case only: the exit save never reaches the server.
 * A real unload keepalive gets past a routed abort and offline emulation, so the
 * page's own request fails instead. This proves recovery after a lost save, not
 * that browsers lose one. The real commit has its own journey with no double.
 */
const reloadLosingExitSave = async (page: Page) =>
  leaveLosingExitSave(page, () => page.reload());
const leaveLosingExitSave = async (
  page: Page,
  leave: () => Promise<unknown>,
) => {
  const roundId = new URL(page.url()).pathname.split('/')[2]!;
  const unsaved = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith('daisy:document-drafts:copy:'))
      .filter((key) => JSON.parse(localStorage.getItem(key)!).active)
      .map((key) => key.slice(key.lastIndexOf(':') + 1)),
  );
  const revisions = await Promise.all(
    unsaved.map(async (id) => {
      const { revision } = await serverDocument(page, roundId, id);
      return [id, revision] as const;
    }),
  );
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
      if (init?.method !== 'POST') mark('unexpected');
      // A debounced autosave can legitimately land before the unload; only the
      // keepalive exit save is lost.
      if (init?.method !== 'POST' || init.keepalive !== true)
        return send(...request);
      mark('lost');
      return Promise.reject(new TypeError('Failed to fetch'));
    });
  }, `${documentsPath}save`);
  await leave();
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
  for (const [id, revision] of revisions)
    expect(
      (await serverDocument(page, roundId, id)).revision,
      'An autosave committed this edit, so no exit save was lost',
    ).toBe(revision);
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
  // A draft follows its document, so another document's offer may sit beside it.
  await expect(
    page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }).first(),
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
  const response = await page.request.post(`${documentsPath}read`, {
    headers: { origin },
    data: { ids: [documentId] },
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
  const second = await documentFromFinishedRound(page);
  const identity = await page.request.get('/api/auth/get-session');
  expect(identity.status()).toBe(200);
  const { user } = (await identity.json()) as {
    user: { id: string; username: string };
  };
  await openDrafts(page, second.roundId, second.title);
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  const secondRecovery = await offeredAfterReload(
    page,
    second.documentId,
    'Second Round REC',
  );
  return { second, user, secondRecovery };
};
const openDrafts = async (page: Page, roundId: string, title = 'Untitled') => {
  await page.goto(`${origin}/rounds/${roundId}`);
  await page
    .getByRole('navigation', { name: 'Files' })
    .getByRole('button', { name: title, exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: title })).toBeVisible();
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
/** Each document's copy follows it, so this one is offered as its own and never mixed. */
const expectSecondRoundOffer = async (page: Page, title: string) => {
  await page
    .getByRole('navigation', { name: 'Files' })
    .getByRole('button', { name: title, exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: `Restore ${title}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: title, exact: true }),
  ).not.toContainText('First Round pending NEW');
  await page.getByText('Compare recovered and server copies').click();
  await expect(page.getByLabel('Recovered copy of Untitled')).toContainText(
    'Second Round REC',
  );
};

test('offline edit survives page loss and explicitly restores into the live editor and server', async ({
  liveRoom,
}) => {
  const { page, documentId, roundId } = liveRoom;
  const context = page.context();
  const url = page.url();
  await context.setOffline(true);
  await edit(page, 'Offline recovery text');
  await expect
    .poll(async () => (await draftFor(page, documentId))?.active?.html)
    .toContain('Offline recovery text');
  await page.close();
  await context.setOffline(false);
  const reopened = await openPage(context, 'reopen private drafts');
  await reopened.goto(url);
  const restore = reopened.getByRole('button', {
    name: /^Restore Untitled( \d+)?$/,
    exact: true,
  });
  await expect(restore).toBeVisible();
  await expect(
    reopened.getByRole('textbox', { name: untitled }),
  ).not.toContainText('Offline recovery text');
  const saved = reopened.waitForResponse(
    (response) =>
      response.url().endsWith(`${documentsPath}save`) && response.ok(),
  );
  await restore.click();
  await expect(reopened.getByRole('textbox', { name: untitled })).toContainText(
    'Offline recovery text',
  );
  await saved;
  expect((await serverDocument(reopened, roundId, documentId)).html).toContain(
    'Offline recovery text',
  );
  await expect.poll(() => draftFor(reopened, documentId)).toBeNull();
});

test('newer server copy stays intact until an informed Restore, with copy available', async ({
  liveRoom,
}, testInfo) => {
  const { page, documentId, roundId } = liveRoom;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await edit(page, 'Local conflict copy');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second paragraph');
  await expect
    .poll(async () => (await draftFor(page, documentId))?.active?.html)
    .toContain('Second paragraph');
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
  await expect(page.getByLabel('Recovered copy of Untitled')).toContainText(
    'Local conflict copy',
  );
  await expect(page.getByLabel('Server copy of Untitled')).toContainText(
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
      Reflect.set(window, '__draftsClipboard', observed);
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
    .getByRole('button', { name: /^Copy recovered Untitled( \d+)?$/ })
    .click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /Copied recovered text\.|Copy was unavailable\./ }),
  ).toBeVisible();
  await testInfo.attach('clipboard-operation', {
    body: JSON.stringify(
      await page.evaluate(() => Reflect.get(window, '__draftsClipboard')),
    ),
    contentType: 'application/json',
  });
  await expect(
    page.getByRole('status').filter({ hasText: 'Copied recovered text.' }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Local conflict copy\n\nSecond paragraph',
  );
  await page.unroute(`**${documentsPath}save`);
  const ack = page.waitForResponse(
    (response) =>
      response.url().endsWith(`${documentsPath}save`) && response.ok(),
  );
  await page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }).click();
  await ack;
  expect((await serverDocument(page, roundId, documentId)).html).toContain(
    'Local conflict copy',
  );
});

test('after a lost exit save, Discard of a recovery offer preserves newer editor typing', async ({
  liveRoom,
}) => {
  const { page, documentId, roundId } = liveRoom;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await edit(page, 'Old recovered choice');
  await expect.poll(() => draftFor(page, documentId)).not.toBeNull();
  await reloadLosingExitSave(page);
  await expect(
    page.getByRole('button', {
      name: /^Discard recovered Untitled( \d+)?$/,
      exact: true,
    }),
  ).toBeVisible();
  await edit(page, 'Newer typing survives discard');
  await page
    .getByRole('button', { name: /^Discard recovered Untitled( \d+)?$/ })
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
  liveRoom,
}) => {
  const { page, documentId, roundId } = liveRoom;
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
    .getByRole('button', { name: /^Discard recovered Untitled( \d+)?$/ })
    .click();
  await expect(
    page.getByRole('button', { name: 'Restore Untitled', exact: true }),
  ).toBeHidden();
  expect(await rawDraftFor(page, documentId)).toBeNull();
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide')),
  );
  await page.reload();
  await expect(page.getByRole('textbox', { name: untitled })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Restore Untitled', exact: true }),
  ).toBeHidden();
  expect(sends).toEqual([]);
  expect(await serverDocument(page, roundId, documentId)).toEqual(server);
});

test('a real exit save with no failure double commits once and leaves no false recovery offer', async ({
  liveRoom,
}) => {
  const { page, roundId, documentId } = liveRoom;
  const start = await serverDocument(page, roundId, documentId);
  // A paused page clock holds the debounce, so only the exit can send this edit.
  await page.clock.install({ time: '2026-11-01T18:00:00Z' });
  await page.clock.pauseAt('2026-11-01T18:01:00Z');
  await typePendingEdit(page, documentId, 'Committed by the real exit');
  await page.reload();
  // Running timers let the recheck settle a commit that lands after the list.
  await page.clock.resume();
  await expect
    .poll(
      async () => (await serverDocument(page, roundId, documentId)).revision,
    )
    .toBe(start.revision + 1);
  await expect(page.getByRole('textbox', { name: untitled })).toContainText(
    'Committed by the real exit',
  );
  await expect(
    page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }),
  ).toHaveCount(0);
  await expect(page.getByText('An unsaved draft is available')).toHaveCount(0);
  await expect.poll(() => rawDraftFor(page, documentId)).toBeNull();
  expect((await serverDocument(page, roundId, documentId)).revision).toBe(
    start.revision + 1,
  );
});

test('an exit save landing after the next page listed moves the editor, with no conflict', async ({
  liveRoom,
}) => {
  const { page, roundId, documentId } = liveRoom;
  // The paused clock holds the recheck, so this commit lands after the page's
  // list and before its second look, which a real exit save cannot be made to do.
  await page.clock.install({ time: '2026-11-01T18:00:00Z' });
  await page.clock.pauseAt('2026-11-01T18:01:00Z');
  const recovery = await offeredAfterReload(
    page,
    documentId,
    'Landed after the list',
  );
  const { revision } = await serverDocument(page, roundId, documentId);
  const editor = page.getByRole('textbox', { name: untitled });
  await editor.click();
  const landed = await page.request.post(`${documentsPath}save`, {
    headers: { origin },
    data: {
      id: documentId,
      html: recovery.html,
      expectedRevision: revision,
    },
  });
  expect(landed.status()).toBe(200);
  await page.clock.runFor(3_000);
  await expect(editor).toContainText('Landed after the list');
  await expect(
    page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }),
  ).toHaveCount(0);
  await expect.poll(() => rawDraftFor(page, documentId)).toBeNull();
  await page.clock.resume();
  await page.keyboard.type('First: ');
  await expect
    .poll(async () => serverDocument(page, roundId, documentId))
    .toMatchObject({
      html: expect.stringMatching(/Landed after the list[\s\S]*First:/),
      revision: revision + 2,
    });
  await expect(page.getByText('A newer save of this file')).toHaveCount(0);
});

test('adopted text keeps the caret in its words and Undo cannot leave it', async ({
  liveRoom,
}) => {
  const { page, roundId, documentId } = liveRoom;
  const editor = page.getByRole('textbox', { name: untitled });
  await edit(page, 'Alpha beta');
  await expect
    .poll(async () => (await serverDocument(page, roundId, documentId)).html)
    .toContain('Alpha beta');
  await page.clock.install({ time: '2026-11-01T18:00:00Z' });
  await page.clock.pauseAt('2026-11-01T18:01:00Z');
  await editor.click();
  await page.keyboard.press('Home');
  await page.keyboard.type('Opening line');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await draftFor(page, documentId))?.active?.html)
    .toContain('Opening line');
  await reloadLosingExitSave(page);
  await expect(
    page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }),
  ).toBeVisible();
  const { recovery } = await draftFor(page, documentId);
  const { revision } = await serverDocument(page, roundId, documentId);
  await editor.click();
  await page.keyboard.press('Home');
  for (let step = 0; step < 'Alpha'.length; step += 1)
    await page.keyboard.press('ArrowRight');
  const landed = await page.request.post(`${documentsPath}save`, {
    headers: { origin },
    data: {
      id: documentId,
      html: recovery.html,
      expectedRevision: revision,
    },
  });
  expect(landed.status()).toBe(200);
  await page.clock.runFor(3_000);
  await expect(editor).toContainText('Opening line');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor).toContainText('Opening line');
  await page.clock.resume();
  await page.keyboard.type('X');
  await expect
    .poll(async () => (await serverDocument(page, roundId, documentId)).html)
    .toContain('AlphaX beta');
  expect((await serverDocument(page, roundId, documentId)).html).toContain(
    'Opening line',
  );
});

test('typing while a late commit lands keeps the text and the caret, and overwrites nothing', async ({
  liveRoom,
}) => {
  const { page, roundId, documentId } = liveRoom;
  await page.clock.install({ time: '2026-11-01T18:00:00Z' });
  await page.clock.pauseAt('2026-11-01T18:01:00Z');
  const recovery = await offeredAfterReload(
    page,
    documentId,
    'Landed under the typing',
  );
  const { revision } = await serverDocument(page, roundId, documentId);
  const editor = page.getByRole('textbox', { name: untitled });
  await editor.click();
  await page.keyboard.type('Typing live');
  const landed = await page.request.post(`${documentsPath}save`, {
    headers: { origin },
    data: {
      id: documentId,
      html: recovery.html,
      expectedRevision: revision,
    },
  });
  expect(landed.status()).toBe(200);
  await page.clock.runFor(3_000);
  await page.keyboard.type(' still here');
  await expect(editor).toContainText('Typing live still here');
  await expect(page.getByText('A newer save of this file')).toBeVisible();
  const server = await serverDocument(page, roundId, documentId);
  expect(server.revision).toBe(revision + 1);
  expect(server.html).toContain('Landed under the typing');
});

test('lost acknowledgement keeps newer typed notes through reload and explicit reconciliation', async ({
  liveRoom,
}) => {
  const { page, roundId, documentId } = liveRoom;
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
    page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }),
  ).toBeVisible();
  expect((await serverDocument(page, roundId, documentId)).html).toContain(
    'Acknowledgement lost A',
  );
  await page.unroute(`**${documentsPath}save`);
  await page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }).click();
  await expect
    .poll(async () => (await serverDocument(page, roundId, documentId)).html)
    .toContain('Newer B after lost acknowledgement');
});

test('unavailable browser storage warns while real online saves continue', async ({
  liveRoom,
}) => {
  const { page, documentId, roundId } = liveRoom;
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('daisy:document-drafts:copy:'))
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
  liveRoom,
}) => {
  await liveRoom.finishRound();
  const { page, roundId, documentId } = liveRoom;
  await openDrafts(page, roundId);
  await page.clock.install();
  let loggedOut = false,
    lateSends = 0;
  await page.route(`**${documentsPath}save`, (route) => {
    if (loggedOut) lateSends++;
    return route.abort();
  });
  await edit(page, 'Private pending drafts before logout');
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
  await expect(page.getByRole('textbox', { name: untitled })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(
    'Private pending drafts before logout',
  );
  await page.clock.runFor(30_000);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect(await draftFor(page, documentId)).toBeNull();
  expect(lateSends).toBe(0);
});

test('observed session revocation fences editing and hides the notes, keeping the copy for the same person', async ({
  liveRoom,
}) => {
  await liveRoom.finishRound();
  const { page, roundId, documentId } = liveRoom;
  await openDrafts(page, roundId);
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await edit(page, 'Pending notes before revocation');
  await expect.poll(() => draftFor(page, documentId)).not.toBeNull();
  const revoked = await page.request.post('/api/auth/revoke-sessions', {
    headers: { origin },
    data: {},
  });
  expect(revoked.status()).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('textbox', { name: untitled })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(
    'Pending notes before revocation',
  );
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect((await draftFor(page, documentId)).active.html).toContain(
    'Pending notes before revocation',
  );
});

/** Cookies leaving the browser, as they do when a session expires. */
const endSession = async (page: Page) => {
  const { cookies } = await page.context().storageState();
  await page.context().clearCookies();
  return cookies;
};

test('a session ending mid-Round hides the notes with nothing readable, and the same person gets them back', async ({
  liveRoom,
}) => {
  await liveRoom.finishRound();
  const { page, roundId, documentId } = liveRoom;
  await openDrafts(page, roundId);
  const cookies = await endSession(page);
  await edit(page, 'Typed as the session ended');
  await expect(page.getByRole('textbox', { name: untitled })).toHaveCount(0);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Sign in' }),
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText(
    'Typed as the session ended',
  );
  expect((await draftFor(page, documentId)).active.html).toContain(
    'Typed as the session ended',
  );
  await page.goto(`${origin}/`);
  expect(await draftFor(page, documentId)).not.toBeNull();
  await page.context().addCookies(cookies);
  await page.goto(`${origin}/rounds/${roundId}`);
  await page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }).click();
  await expect
    .poll(async () => (await serverDocument(page, roundId, documentId)).html)
    .toContain('Typed as the session ended');
});

test('a session ending and then a different account signing in erases the copy without showing it', async ({
  liveRoom,
}) => {
  await liveRoom.finishRound();
  const { page, roundId, documentId, stranger } = liveRoom;
  await openDrafts(page, roundId);
  await endSession(page);
  await edit(page, 'Private to the expired account');
  await expect.poll(() => draftFor(page, documentId)).not.toBeNull();
  await expect(page.getByRole('textbox', { name: untitled })).toHaveCount(0);
  await page.goto(`${origin}/`);
  expect(await draftFor(page, documentId)).not.toBeNull();
  const { cookies } = await stranger.storageState();
  await page.context().addCookies(cookies);
  await page.goto(`${origin}/settings`);
  await expect.poll(() => draftFor(page, documentId)).toBeNull();
  await expect(page.locator('body')).not.toContainText(
    'Private to the expired account',
  );
});

test('a 403 refused save keeps the editor text and the draft', async ({
  liveRoom,
}) => {
  await liveRoom.finishRound();
  const { page, roundId, documentId } = liveRoom;
  await openDrafts(page, roundId);
  await page.route(`**${documentsPath}save`, (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'AUTHORIZATION' } }),
    }),
  );
  await edit(page, 'Typed while refused');
  await expect(page.getByText('can’t be saved')).toBeVisible();
  await expect(page.getByRole('textbox', { name: untitled })).toContainText(
    'Typed while refused',
  );
  expect((await draftFor(page, documentId)).active.html).toContain(
    'Typed while refused',
  );
  await page.reload();
  await expect(
    page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }),
  ).toBeVisible();
});

test('after a lost exit save, conflict state stays true through typing, Restore and Discard', async ({
  liveRoom,
}) => {
  await liveRoom.finishRound();
  const { page, roundId, documentId } = liveRoom;
  await openDrafts(page, roundId);
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await offeredAfterReload(page, documentId, 'Offered before the conflict');
  await page.unroute(`**${documentsPath}save`);
  const current = await serverDocument(page, roundId, documentId);
  const elsewhere = await page.request.post(`${documentsPath}save`, {
    headers: { origin },
    data: {
      id: documentId,
      html: '<p>Saved in another tab</p>',
      expectedRevision: current.revision,
    },
  });
  expect(elsewhere.status()).toBe(200);
  const conflict = page
    .getByRole('alert')
    .filter({ hasText: 'A newer save of this file arrived.' });
  await edit(page, 'Typed into the conflict');
  await expect(conflict).toBeVisible();
  await edit(page, 'Typed again into the conflict');
  await expect(conflict).toBeVisible();
  await expect(page.getByText('Saving', { exact: true })).toHaveCount(0);
  await page.getByText('Compare recovered and server copies').click();
  await expect(page.getByLabel('Server copy of Untitled')).toContainText(
    'Saved in another tab',
  );
  await page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }).click();
  await expect
    .poll(async () => (await serverDocument(page, roundId, documentId)).html)
    .toContain('Offered before the conflict');
  await expect(conflict).toBeHidden();
  await page
    .getByRole('button', { name: /^Discard recovered Untitled( \d+)?$/ })
    .click();
  await expect(
    page.getByRole('button', { name: 'Restore Untitled', exact: true }),
  ).toBeHidden();
  await expect(page.getByText('An unsaved draft is available')).toHaveCount(0);
});

test('account switch purges old-principal recovery across tabs without revealing it to the next member', async ({
  liveRoom,
}) => {
  const { page, roundId, documentId, stranger } = liveRoom;
  await liveRoom.finishRound();
  await openDrafts(page, roundId);
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
  await expect(page.getByRole('textbox', { name: untitled })).toHaveCount(0);
});

test('multibyte multi-document exit keeps overflow recoverable after a lost exit save and each choice targets its own file', async ({
  liveRoom,
}) => {
  const { page, roundId, documentId } = liveRoom;
  const second = await createMemberDocument(page.request);
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Files' })
    .getByRole('button', { name: 'Untitled', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Untitled', exact: true }),
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
  // The budget admits one body; which one is not a promise, so the other is the overflow.
  const landedFirst =
    (JSON.parse(bodies[0]!) as { id: string }).id === documentId;
  const [landed, overflow] = landedFirst
    ? [
        { id: documentId, title: 'Untitled', text: '界' },
        { id: second.id as string, title: second.title as string, text: '語' },
      ]
    : [
        { id: second.id as string, title: second.title as string, text: '語' },
        { id: documentId, title: 'Untitled', text: '界' },
      ];
  release();
  await expect
    .poll(async () => (await serverDocument(page, roundId, landed.id)).html)
    .toContain(landed.text);
  await page.unroute(`**${documentsPath}save`);
  // Timers stay paused until after the reload, so no autosave can commit first.
  await reloadLosingExitSave(page);
  await page.clock.resume();
  await expect(
    page.getByRole('button', {
      name: `Restore ${overflow.title}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Restore ${landed.title}`, exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: `Restore ${overflow.title}`, exact: true })
    .click();
  await expect
    .poll(async () => (await serverDocument(page, roundId, overflow.id)).html)
    .toContain(overflow.text);
  expect((await serverDocument(page, roundId, landed.id)).html).toContain(
    landed.text,
  );
});

test('typing straight through the Round closing: every word the editor showed is offered on the result page the Room moves to', async ({
  liveRoom,
}) => {
  const { page, documentId } = liveRoom;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await page.getByRole('textbox', { name: untitled }).focus();
  // What a person last saw in the Room's editor. The observer stops when that
  // editor goes, since the result page's own textboxes must not count.
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const shown = document.querySelector('[contenteditable="true"].room-doc');
      if (shown) Reflect.set(window, '__lastShown', shown.textContent);
      else observer.disconnect();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  const typeUntilTheRoomLeaves = async () => {
    for (let word = 0; page.url().endsWith('/room') && word < 200; word += 1)
      await page.keyboard.insertText(`word${word} `);
  };
  const closeTheRound = async () => {
    await liveRoom.forfeitRound();
    // Coming back to the tab reads at once, so the Room's own move has no wait
    // on a doorbell, which carries no delivery guarantee.
    await page.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
  };
  await Promise.all([typeUntilTheRoomLeaves(), closeTheRound()]);
  await expect(page).toHaveURL(`${origin}/rounds/${liveRoom.roundId}`);
  const files = page.getByRole('region', { name: 'Your files' });
  await expect(
    files.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }),
  ).toBeVisible();
  const shown = String(
    await page.evaluate(() => Reflect.get(window, '__lastShown')),
  );
  const words = shown.match(/word\d+ /g) ?? [];
  expect(words.length).toBeGreaterThan(0);
  const draft = await draftFor(page, documentId);
  expect(draft).not.toBeNull();
  for (const word of words) expect(draft.recovery.html).toContain(word);
  await files.getByText('Compare recovered and server copies').click();
  await expect(page.getByLabel('Recovered copy of Untitled')).toContainText(
    words.at(-1)!.trim(),
  );
});

test('after a lost exit save, the Round receipt visibly restores a private draft through the same sync owner', async ({
  liveRoom,
}) => {
  const { page, roundId, documentId } = liveRoom;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await liveRoom.finishRound();
  await openDrafts(page, roundId);
  await edit(page, 'Receipt recovery text');
  await expect.poll(() => draftFor(page, documentId)).not.toBeNull();
  await leaveLosingExitSave(page, () =>
    page.goto(`${origin}/rounds/${roundId}`),
  );
  const files = page.getByRole('region', { name: 'Your files' });
  await expect(
    files.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }),
  ).toBeVisible();
  await expect(
    files.getByRole('textbox', { name: untitled }),
  ).not.toContainText('Receipt recovery text');
  await page.unroute(`**${documentsPath}save`);
  await files
    .getByRole('button', { name: /^Restore Untitled( \d+)?$/ })
    .click();
  await expect(files.getByRole('textbox', { name: untitled })).toContainText(
    'Receipt recovery text',
  );
  await expect
    .poll(async () => (await serverDocument(page, roundId, documentId)).html)
    .toContain('Receipt recovery text');
  await expect.poll(() => draftFor(page, documentId)).toBeNull();
});

test('actual deferred A acknowledgement rebases B and leaves it unsaved until its own acknowledgement', async ({
  liveRoom,
}) => {
  const { page, roundId, documentId } = liveRoom;
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
  liveRoom,
}) => {
  const { page, roundId, documentId } = liveRoom;
  const other = await openPage(
    page.context(),
    'concurrent private-note editor',
  );
  await other.goto(page.url());
  await expect(other.getByRole('textbox', { name: untitled })).toBeVisible();
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
      .filter({ hasText: 'A newer save of this file arrived.' }),
  ).toBeVisible();
  expect((await serverDocument(page, roundId, documentId)).html).toContain(
    'Accepted first-tab text',
  );
  expect((await draftFor(other, documentId)).active.html).toContain(
    'Conflicting second-tab text',
  );
  await other.reload();
  await expect(
    other.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }),
  ).toBeVisible();
  await expect(other.getByRole('textbox', { name: untitled })).toContainText(
    'Accepted first-tab text',
  );
  await other
    .getByRole('button', { name: /^Restore Untitled( \d+)?$/ })
    .click();
  await expect
    .poll(async () => (await serverDocument(other, roundId, documentId)).html)
    .toContain('Conflicting second-tab text');
  await expect.poll(() => draftFor(other, documentId)).toBeNull();
});

for (const reloadBeforeRestore of [false, true])
  test(`after a lost exit save, recovery survives newer typing and acknowledgement${reloadBeforeRestore ? ' and another reload' : ''} before explicit Restore`, async ({
    liveRoom,
  }) => {
    const { page, documentId, roundId } = liveRoom;
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
      page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }),
    ).toBeVisible();
    expect((await draftFor(page, documentId)).recovery).toEqual(recovery);
    expect((await serverDocument(page, roundId, documentId)).html).toContain(
      'Acknowledged NEW',
    );
    await page
      .getByRole('button', { name: /^Restore Untitled( \d+)?$/ })
      .click();
    await expect(page.getByRole('textbox', { name: untitled })).toContainText(
      'Independent REC',
    );
    await expect
      .poll(async () => (await serverDocument(page, roundId, documentId)).html)
      .toContain('Independent REC');
    await expect.poll(() => draftFor(page, documentId)).toBeNull();
  });

test('after a lost exit save, Restore over pending NEW keeps NEW as an independent durable offer after REC saves', async ({
  liveRoom,
}) => {
  const { page, documentId, roundId } = liveRoom;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await edit(page, 'REC for swap');
  await expect
    .poll(async () => (await draftFor(page, documentId))?.active?.html)
    .toContain('REC for swap');
  await reloadLosingExitSave(page);
  await expect(
    page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }),
  ).toBeVisible();
  await edit(page, 'Pending NEW for swap');
  await expect
    .poll(async () => (await draftFor(page, documentId))?.active?.html)
    .toContain('Pending NEW for swap');
  const pending = (await draftFor(page, documentId)).active;
  await page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }).click();
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
    page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }),
  ).toBeVisible();
  await page.getByText('Compare recovered and server copies').click();
  await expect(page.getByLabel('Recovered copy of Untitled')).toContainText(
    'Pending NEW for swap',
  );
});

test('after a lost exit save, denied clipboard permission exposes selectable recovered text without consuming the offer', async ({
  liveRoom,
}) => {
  const { page, documentId } = liveRoom;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await edit(page, 'Manual recovery copy');
  await expect
    .poll(async () => (await draftFor(page, documentId))?.active?.html)
    .toContain('Manual recovery copy');
  await reloadLosingExitSave(page);
  await expect(
    page.getByRole('button', { name: /^Copy recovered Untitled( \d+)?$/ }),
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
      .getByRole('button', { name: /^Copy recovered Untitled( \d+)?$/ })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Copy was unavailable' }),
    ).toBeVisible();
    const manual = page.getByRole('textbox', {
      name: /^Recovered text to copy from Untitled( \d+)?$/,
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
      page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }),
    ).toBeVisible();
  } finally {
    await session.detach();
  }
});

for (const refusal of ['denied storage', 'combined overflow'] as const)
  test(`${refusal === 'denied storage' ? 'after a lost exit save, denied storage' : 'a real exit with an edit over the budget stays unsent and combined overflow'} preserves the recovery offer and current editor while NEW still saves online`, async ({
    liveRoom,
  }) => {
    const { page, documentId, roundId } = liveRoom;
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
          if (key.startsWith('daisy:document-drafts:copy:'))
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
        .getByRole('button', { name: /^Restore Untitled( \d+)?$/ })
        .click();
      await expect(page.getByRole('textbox', { name: untitled })).toContainText(
        next,
      );
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
        page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }),
      ).toBeVisible();
    } finally {
      gate.resolve();
    }
  });

test('after a lost exit save, Server copy comparison keeps showing the server text while newer typing is unsaved', async ({
  liveRoom,
}) => {
  const { page, roundId, documentId } = liveRoom;
  await page.route(`**${documentsPath}save`, (route) => route.abort());
  await offeredAfterReload(page, documentId, 'Offered REC');
  const server = await serverDocument(page, roundId, documentId);
  expect(server.html).not.toContain('Unsaved NEW');
  await edit(page, 'Unsaved NEW');
  await page.getByText('Compare recovered and server copies').click();
  await expect(page.getByLabel('Recovered copy of Untitled')).toContainText(
    'Offered REC',
  );
  await expect(page.getByLabel('Server copy of Untitled')).not.toContainText(
    'Unsaved NEW',
  );
  expect((await serverDocument(page, roundId, documentId)).html).toBe(
    server.html,
  );
});

test('after lost exit saves, original copy expiry withdraws only that offer while later swapped recovery survives reload', async ({
  liveRoom,
}) => {
  const { page, roundId, documentId } = liveRoom;
  await liveRoom.finishRound();
  await openDrafts(page, roundId);
  const { revision: startRevision } = await serverDocument(
    page,
    roundId,
    documentId,
  );
  const revisionTrail: Record<string, number> = {};
  const draftRevision = async (step: string) => {
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
  await draftRevision('after first reload');
  await page.clock.setSystemTime(new Date(recovery.savedAt + 60_000));
  await edit(page, 'Later independent NEW');
  const beforeSwap = await draftFor(page, documentId);
  expect(beforeSwap.recovery).toEqual(recovery);
  const active = beforeSwap.active;
  expect(active.generation).toMatch(/^[a-z0-9]{24}$/);
  expect(active.html).toContain('Later independent NEW');
  expect(active.savedAt).toBeGreaterThan(recovery.savedAt);
  await page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }).click();
  const swapped = await draftFor(page, documentId);
  await draftRevision('after Restore');
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
    page.getByRole('button', { name: /^Restore Untitled( \d+)?$/ }),
  ).toBeVisible();
  expect(await draftFor(page, documentId)).toEqual({ recovery: active });
  await draftRevision('after second reload');
  // No save, ordinary or at exit, reached the server through this journey.
  expect(revisionTrail).toEqual({
    'after first reload': startRevision,
    'after Restore': startRevision,
    'after second reload': startRevision,
  });
  await page.getByText('Compare recovered and server copies').click();
  await expect(page.getByLabel('Recovered copy of Untitled')).toContainText(
    'Later independent NEW',
  );
  await expect(
    page.getByRole('region', { name: /^Recovered Untitled( \d+)?$/ }),
  ).not.toContainText('Original expiring REC');
});

test('controlled router-lifecycle proof, not end-user navigation: Round replacement flushes pending drafts without purging either Round recovery, the other Round seeded by a lost exit save', async ({
  liveRoom,
}) => {
  const { page, roundId, documentId } = liveRoom;
  const { second, user, secondRecovery } =
    await secondRoundWithRecovery(liveRoom);
  const principalId = user.id;
  expect(principalId).toMatch(/^[a-z0-9]{24}$/);
  await openDrafts(page, roundId);
  const firstRecovery = await offeredAfterReload(
    page,
    documentId,
    'First Round REC',
  );
  const scopes = await page.evaluate(
    ({ principalId, documentId, second }) => {
      const firstKey = `daisy:document-drafts:copy:${principalId}:${documentId}`;
      const secondKey = `daisy:document-drafts:copy:${principalId}:${second.documentId}`;
      return [
        localStorage.getItem(firstKey),
        localStorage.getItem(secondKey),
      ].map((raw) => (raw === null ? null : JSON.parse(raw)));
    },
    { principalId, documentId, second },
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
    Reflect.set(window, '__draftsRoundNavigation', 'same-browser-owner'),
  );
  await page
    .getByRole('navigation', { name: 'Files' })
    .getByRole('button', { name: 'Untitled', exact: true })
    .click();
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
    await page.evaluate(() => Reflect.get(window, '__draftsRoundNavigation')),
  ).toBe('same-browser-owner');
  await expect
    .poll(async () => (await serverDocument(page, roundId, documentId)).html)
    .toContain('First Round pending NEW');
  expect(await draftFor(page, documentId)).toEqual({ recovery: firstRecovery });
  expect(await draftFor(page, second.documentId)).toEqual({
    recovery: secondRecovery,
  });
  await expectSecondRoundOffer(page, second.title);
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

test('end-user navigation: leaving a Round through the account menu saves pending drafts and browser Back returns through both Rounds via the profile page, the other Round seeded by a lost exit save', async ({
  liveRoom,
}) => {
  const { page, roundId, documentId } = liveRoom;
  const { second, user, secondRecovery } =
    await secondRoundWithRecovery(liveRoom);
  const { username } = user;
  await page.unroute(`**${documentsPath}save`);
  await openDrafts(page, roundId);
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
  await expect(page.getByRole('textbox', { name: untitled })).toContainText(
    'First Round pending NEW',
  );
  await expect(
    page.getByRole('button', { name: 'Restore Untitled', exact: true }),
  ).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(`${origin}/rounds/${second.roundId}`);
  await expectSecondRoundOffer(page, second.title);
  expect(sends).toHaveLength(1);
  expect(await draftFor(page, second.documentId)).toEqual({
    recovery: secondRecovery,
  });
});
