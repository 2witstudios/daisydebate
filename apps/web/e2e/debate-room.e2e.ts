import { signUpMember } from './support/accounts';
import { assertNoSeriousFindings } from './support/axe';
import { watchCspViolations } from './support/csp';
import { expect, test } from './support/fixtures';

// The room's own mode decides the round: a casual room plays unrated, a
// ranked room plays rated.
const room = '/rooms/room-newcomers/round';
const rankedRoom = '/rooms/room-tuesday-night/round';

test('the round room: palette, editor, marks and dividers', async ({
  page,
}) => {
  await signUpMember(page.request);
  const violations = await watchCspViolations(page);
  await page.goto(room);
  await expect(page.getByRole('timer')).toContainText('2:46');

  // ⌘K / Ctrl+K opens the palette; a new flow lands as "Flow 2".
  const editor = page.getByRole('textbox', { name: 'Flow', exact: true });
  await expect(editor).toBeVisible();
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

  // The editor takes typing and a debate mark.
  const fresh = page.getByRole('textbox', { name: 'Flow 2' });
  await fresh.locator('li p').first().click();
  await page.keyboard.type('dropped C3');
  await fresh.locator('li p').first().click({ clickCount: 3 });
  await page.getByRole('button', { name: 'Dropped', exact: true }).click();
  await expect(fresh.locator('[data-debate-mark="dropped"]')).toHaveText(
    'dropped C3',
  );

  // Dragging the files divider widens the tree.
  const divider = page.getByRole('separator', { name: 'Resize files' });
  const box = await divider.boundingBox();
  if (!box) throw new Error('The files divider has no box');
  // Grab near the top: the pane runs below a 720px viewport.
  await page.mouse.move(box.x + box.width / 2, box.y + 24);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + 24, { steps: 4 });
  await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', '300');

  // Arrow keys nudge it back.
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '284');

  // Typing, marking, the palette and the dividers ran under the nonce CSP.
  expect(await violations.read()).toEqual({
    eventViolations: [],
    consoleViolations: [],
  });
});

test('a rated round keeps the sidebar to the round chat', async ({ page }) => {
  await signUpMember(page.request);
  await page.goto(rankedRoom);
  const sidebar = page.getByRole('tablist', { name: 'Sidebar' });
  await expect(sidebar.getByRole('tab', { name: 'Chat' })).toBeVisible();
  await expect(sidebar.getByRole('tab', { name: 'AI' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '# prep' })).toHaveCount(0);
});

test('an agent edit applies to the document it names', async ({ page }) => {
  await signUpMember(page.request);
  await page.goto(`${room}?phase=prep`);
  const tab = page
    .getByRole('group', { name: 'Open files' })
    .getByRole('button', { name: 'NR plan', exact: true });
  // The NR plan is already open in the editor when the edit lands.
  await tab.click();
  const plan = page.getByRole('textbox', { name: 'NR plan' });
  await expect(plan).toContainText('N3 hospital exemption New in 1AR');
  await page.getByRole('tab', { name: 'AI' }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(tab).toHaveAttribute('aria-current', 'page');
  await expect(plan).toContainText('extra time on N2 weighing');
  await expect(plan).toContainText('call it out and move on');
  await expect(plan).not.toContainText('New in 1AR');
});

test('the room has no serious or critical accessibility findings', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.goto(`${room}?phase=prep`);
  await expect(
    page.getByRole('textbox', { name: 'Flow', exact: true }),
  ).toBeVisible();
  await assertNoSeriousFindings(page);
  await page.getByRole('tab', { name: 'AI' }).click();
  await assertNoSeriousFindings(page);
});

test('a bot round keeps the debater’s files across a reload', async ({
  page,
}) => {
  await signUpMember(page.request);
  const violations = await watchCspViolations(page);
  await page.goto('/ai-debate?bot=wren');
  await page.getByText('Negative', { exact: true }).click();
  await page.getByRole('button', { name: 'Start debate' }).click();
  await expect(page).toHaveURL(/\/ai-debate\/[a-z0-9]+$/);
  await expect(
    page.getByRole('button', { name: 'Begin debate' }),
  ).toBeVisible();
  // The bot pages' shared chunk already reports Zod's eval probe on load
  // (ISSUE-344); what is proven here is that editing adds nothing.
  const loaded = await violations.read();

  // A new flow from the palette, written into and saved.
  await page.keyboard.press('ControlOrMeta+k');
  await page
    .getByRole('combobox', { name: 'Search commands' })
    .fill('new flow');
  await page.keyboard.press('Enter');
  const flow = page.getByRole('textbox', { name: 'Flow', exact: true });
  await flow.locator('li p').first().click();
  await page.keyboard.type('they dropped the turn');
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/debate-room/documents/save') &&
      response.ok(),
  );
  await saved;

  // Creating, typing and saving in the bot room ran under the nonce CSP.
  const edited = await violations.read();
  expect({
    eventViolations: edited.eventViolations.slice(
      loaded.eventViolations.length,
    ),
    consoleViolations: edited.consoleViolations.slice(
      loaded.consoleViolations.length,
    ),
  }).toEqual({ eventViolations: [], consoleViolations: [] });

  await page.reload();
  await page
    .getByRole('navigation', { name: 'Files' })
    .getByRole('button', { name: 'Flow', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Flow', exact: true }),
  ).toContainText('they dropped the turn');
});
