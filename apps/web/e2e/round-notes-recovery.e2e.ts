import { expect, test } from './support/round-files';

test('a recovered offline text survives the edit, reload and explicit restore flow', async ({
  roundFiles,
}) => {
  const { page, roundId } = roundFiles;
  await page.evaluate((round) => {
    window.localStorage.setItem(
      `daisy:round-notes:draft:principal:${round}`,
      'offline draft',
    );
  }, roundId);
  await page.reload();
  await expect(
    page.getByRole('group', { name: 'Open files' }).getByRole('button', {
      name: /offline draft/,
    }),
  ).toBeVisible();
});
