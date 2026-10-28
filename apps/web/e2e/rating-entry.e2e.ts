import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createId } from '@paralleldrive/cuid2';
import { test, expect, openPage } from './support/fixtures';
import { resetRateLimits, signUpMember } from './support/accounts';
import { submitCreateRoom, closeRoom } from './support/room-launch-flow';

test('native no-JavaScript rated entry preserves canonical ladder setup for all three ladders', async ({
  browser,
}) => {
  test.setTimeout(120_000);
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
        error
          ? reject(new Error('Rating season proof setup refused'))
          : resolve(),
    ),
  );
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await openPage(context, 'native rated setup');
  try {
    await resetRateLimits(page.request);
    const member = await signUpMember(page.request);
    for (const ladder of ['freestyle', 'policy', 'value']) {
      await page.goto('/play/room');
      await expect(page.getByLabel('Rating', { exact: true })).toHaveValue(
        'casual',
      );
      await page.getByLabel('Rating', { exact: true }).selectOption('ranked');
      const room = await submitCreateRoom(
        page,
        `Rated ${ladder} ${createId().slice(0, 8)}`,
        ladder,
      );
      try {
        expect(room.competitionType).toBe('ranked');
        expect(room.formatId).toBe(ladder);
        await expect(page.getByRole('heading').first()).toBeVisible();
        await page.goto(`/leaderboard?ladder=${ladder}`);
        await expect(
          page.getByRole('heading', { name: 'Leaderboard', exact: true }),
        ).toBeVisible();
        await page.goto(`/leaderboard/seasons?ladder=${ladder}`);
        await expect(
          page.getByRole('heading', { level: 2 }).first(),
        ).toContainText(ladder[0]!.toUpperCase() + ladder.slice(1));
      } finally {
        await closeRoom(page.request, room.id);
      }
    }
    const evidence = await new Promise<
      readonly {
        ladder: string;
        roundId: string;
        rating: number;
        delta: number;
      }[]
    >((resolve, reject) => {
      const child = execFile(
        'bun',
        [
          fileURLToPath(
            new URL('./support/rating-display-worker.ts', import.meta.url),
          ),
        ],
        { timeout: 20000 },
        (error, output) =>
          error
            ? reject(new Error('Rating display fixture refused'))
            : resolve(JSON.parse(output)),
      );
      child.stdin?.end(JSON.stringify({ username: member.username }));
    });
    for (const row of evidence) {
      await page.goto(
        `/leaderboard?ladder=${row.ladder}&status=everyone&q=${member.username}`,
      );
      await expect(
        page.getByText(String(row.rating), { exact: true }).first(),
      ).toBeVisible();
      await page.goto(`/profile/${member.username}`);
      const ratings = page.getByRole('region', {
        name: 'Ratings',
        exact: true,
      });
      await expect(ratings).toContainText(`${row.rating} · Provisional`);
      await page.goto(`/rounds/${row.roundId}`);
      await expect(
        page.getByRole('region', { name: 'Round ratings', exact: true }),
      ).toContainText(`${row.rating} · Provisional (+${row.delta})`);
    }
  } finally {
    await context.close();
  }
});
