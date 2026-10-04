import { signUpMember } from './support/accounts';
import { expect, test } from './support/fixtures';

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the bot room starts a debate with a real form post', async ({
    page,
  }) => {
    await signUpMember(page.request);
    await page.goto('/ai-debate?bot=bram');
    await page.getByText('Negative', { exact: true }).click();
    await page.getByRole('button', { name: 'Start debate' }).click();
    await expect(page).toHaveURL(/\/ai-debate\/[a-z0-9]+$/);
  });
});

test('a debate link that leads nowhere says so instead of loading forever', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.goto('/ai-debate/nosuchdebate0000000000000');
  await expect(
    page.getByRole('heading', { name: 'This debate is not here' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Train' })).toBeVisible();
});
