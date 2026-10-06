import { signUpMember } from './support/accounts';
import { assertNoSeriousFindings } from './support/axe';
import { expect, test } from './support/fixtures';

const room = '/rooms/room-tuesday-night/round';

test('the round room: palette, editor, marks and dividers', async ({
  page,
}) => {
  await signUpMember(page.request);
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
});

test('a rated round keeps the sidebar to the round chat', async ({ page }) => {
  await signUpMember(page.request);
  await page.goto(`${room}?rated=1`);
  const sidebar = page.getByRole('tablist', { name: 'Sidebar' });
  await expect(sidebar.getByRole('tab', { name: 'Chat' })).toBeVisible();
  await expect(sidebar.getByRole('tab', { name: 'AI' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '# prep' })).toHaveCount(0);
});

test('an agent edit applies to the document it names', async ({ page }) => {
  await signUpMember(page.request);
  await page.goto(`${room}?phase=prep`);
  await page.getByRole('tab', { name: 'AI' }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(
    page
      .getByRole('group', { name: 'Open files' })
      .getByRole('button', { name: 'NR plan', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('textbox', { name: 'NR plan' })).toContainText(
    'extra time on N2 weighing',
  );
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
