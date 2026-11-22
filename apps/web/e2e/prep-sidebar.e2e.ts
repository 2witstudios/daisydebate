import { signUpMember } from './support/accounts';
import { test } from './support/fixtures';
import { assertPrepSidebar } from './support/prep-sidebar';

test('Prep keeps the saved desktop sidebar setting through Home and back', async ({
  page,
  context,
}) => {
  await signUpMember(context.request);
  const viewport = { width: 1440, height: 900 };
  await page.setViewportSize(viewport);
  await page.goto('/prep');
  await assertPrepSidebar(page, viewport);
});
