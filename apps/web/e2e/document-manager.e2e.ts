import { createId } from '@paralleldrive/cuid2';
import type { Page } from '@playwright/test';
import { origin } from './support/accounts';
import { expect, openPage, test } from './support/fixtures';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import {
  prepareRoomAs,
  readyUp,
  startRoundInBrowser,
} from './support/room-launch-flow';
import { settledLaunchAuth } from './support/room-launch-settled';
import { forfeitOwnSeat } from './support/settle-left-round';
import { watchCspViolations } from './support/csp';

const tree = (page: Page) => page.getByRole('navigation', { name: 'Files' });

const typeInto = async (page: Page, title: string, text: string) => {
  const editor = page.getByRole('textbox', { name: title, exact: true });
  await expect(editor).toBeVisible();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/documents/save') && response.ok(),
  );
  await editor.click();
  await page.keyboard.type(text);
  await saved;
};

/** A document made at /prep, found by a word from its body, edited during timed prep. */
const journey = async (
  browser: Parameters<typeof createRoomLaunchAccounts>[0],
  viewport: { readonly width: number; readonly height: number },
) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  let roundId: string | undefined;
  const word = `evidence${createId().slice(0, 10)}`;
  const context = accounts.members[0]!.context;
  await context.grantPermissions(['camera', 'microphone'], { origin });
  const page = await openPage(context, 'the document manager');
  try {
    await page.setViewportSize(viewport);
    const violations = await watchCspViolations(page);

    await page.goto(`${origin}/prep`);
    await expect(page.getByRole('heading', { name: 'Prep' })).toBeVisible();
    await page
      .getByRole('button', { name: 'New document', exact: true })
      .click();
    await typeInto(page, 'Untitled', `Strongest card ${word}`);

    // A folder, and the document moved into it, through the same tree.
    const narrow = viewport.width < 901;
    if (narrow) await expect(tree(page)).toBeVisible();
    await tree(page).getByText('New folder').first().click();
    await tree(page).getByLabel('Folder name').fill('Cases');
    await tree(page).getByRole('button', { name: 'Create folder' }).click();
    const folder = tree(page).getByRole('button', {
      name: 'Cases',
      exact: true,
    });
    await expect(folder).toBeVisible();
    await tree(page).getByLabel('Actions for Untitled').click();
    await tree(page)
      .getByLabel('Move Untitled to')
      .selectOption({ label: 'Cases' });
    await tree(page).getByRole('button', { name: 'Move', exact: true }).click();
    await folder.click();
    await expect(
      tree(page).getByRole('button', { name: 'Untitled', exact: true }),
    ).toBeVisible();

    // Into a live Round, in its timed prep.
    const prepared = await prepareRoomAs(
      page,
      `Document manager ${createId().slice(0, 8)}`,
      'Affirmative 1',
    );
    const configured = await page.request.post(
      `/api/rooms/${prepared.id}/commands`,
      {
        headers: { origin },
        data: {
          commandId: createId(),
          expectedVersion: prepared.version,
          type: 'update-config',
          config: {
            ...prepared.config,
            preRoundPrep: { enabled: true, durationMs: 120_000 },
          },
        },
      },
    );
    expect(configured.status()).toBe(200);
    await page.reload();
    await readyUp(page);
    roundId = await startRoundInBrowser(page);
    await page.goto(`${origin}/rounds/${roundId}/room`);
    if (narrow)
      await page
        .getByRole('navigation', { name: 'Round' })
        .getByRole('button', { name: 'Files' })
        .click();
    await tree(page).getByRole('button', { name: 'Open or create' }).click();
    await page.getByRole('combobox', { name: 'Search commands' }).fill(word);
    const hit = page.getByRole('option', { name: /Untitled/ });
    await expect(hit).toContainText(word);
    await hit.click();
    const answer = `Answered in prep ${word}`;
    await typeInto(page, 'Untitled', answer);

    // Back at /prep, it is the same document.
    await page.goto(`${origin}/prep`);
    await expect(
      page.getByRole('textbox', { name: 'Untitled', exact: true }),
    ).toContainText(answer);
    expect(await violations.read()).toEqual({
      eventViolations: [],
      consoleViolations: [],
    });
  } finally {
    if (roundId)
      await forfeitOwnSeat(
        context.request,
        roundId,
        (seat) => seat.role === 'affirmative' && seat.slot === 0,
      );
    await settledLaunchAuth();
    await accounts.closeContexts();
  }
};

test('a document made at /prep is found and edited during prep in a live Round', async ({
  browser,
}) => {
  await journey(browser, { width: 1280, height: 800 });
});

test('the same journey on a phone', async ({ browser }) => {
  await journey(browser, { width: 390, height: 844 });
});

test('a document deleted in another tab keeps its text and saves as new', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  const context = accounts.members[0]!.context;
  const text = `kept${createId().slice(0, 10)}`;
  try {
    const page = await openPage(context, 'the open document');
    await page.goto(`${origin}/prep`);
    await page
      .getByRole('button', { name: 'New document', exact: true })
      .click();
    await typeInto(page, 'Untitled', text);
    const id = (await page.request
      .post('/api/documents/recent', { headers: { origin }, data: {} })
      .then((response) => response.json())) as { id: string };
    const deleted = await page.request.post('/api/documents/delete', {
      headers: { origin },
      data: { id: id.id },
    });
    expect(deleted.status()).toBe(200);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText('was deleted', { exact: false })).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Untitled', exact: true }),
    ).toContainText(text);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/documents/save') && response.ok(),
    );
    await page.getByRole('button', { name: 'Save as a new document' }).click();
    await saved;
    await page.reload();
    await expect(
      page.getByRole('textbox', { name: 'Untitled', exact: true }),
    ).toContainText(text);
  } finally {
    await settledLaunchAuth();
    await accounts.closeContexts();
  }
});
