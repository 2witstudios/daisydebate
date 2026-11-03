import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createId } from '@paralleldrive/cuid2';
import { test, expect, openPage } from './support/fixtures';
import { resetRateLimits, signUpMember } from './support/accounts';
import { submitCreateRoom, closeRoom } from './support/room-launch-flow';

test('a ranked seat signs the content waiver without JavaScript', async ({
  browser,
}) => {
  await new Promise<void>((resolve, reject) =>
    execFile(
      'bun',
      [
        fileURLToPath(
          new URL('./support/rating-season-worker.ts', import.meta.url),
        ),
      ],
      { timeout: 20000 },
      (error) =>
        error ? reject(new Error('Season setup refused')) : resolve(),
    ),
  );
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await openPage(context, 'native content waiver');
  try {
    await resetRateLimits(page.request);
    await signUpMember(page.request);
    await page.goto('/play/room');
    const room = await submitCreateRoom(
      page,
      `Ranked waiver ${createId().slice(0, 8)}`,
      'freestyle',
      true,
    );
    try {
      await page
        .getByRole('button', { name: /claim|take seat/i })
        .first()
        .click();
      const waiver = page.getByRole('heading', {
        name: 'Sign the ranked content waiver',
      });
      await expect(waiver).toBeVisible();
      await expect(page.getByText('draft for counsel').first()).toBeVisible();
      await page
        .getByRole('checkbox', {
          name: 'I agree to the ranked content waiver for this season.',
        })
        .check();
      await page.getByRole('button', { name: 'Sign waiver' }).click();
      await expect(waiver).toHaveCount(0);
      await expect(
        page.getByRole('note').getByText('stays after you close your account'),
      ).toBeVisible();
    } finally {
      await closeRoom(page.request, room.id);
    }
  } finally {
    await context.close();
  }
});
