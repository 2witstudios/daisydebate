import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createId } from '@paralleldrive/cuid2';
import { test, expect, openPage } from './support/fixtures';
import { resetRateLimits, signUpMember } from './support/accounts';
import { submitCreateRoom, closeRoom } from './support/room-launch-flow';
import type { RatingStyle } from '@daisy/protocol';

test('ranked entry preserves canonical setup for the one Freestyle ladder', async ({
  browser,
}, testInfo) => {
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
  const context = await browser.newContext();
  const page = await openPage(context, 'ranked setup');
  const capture = async (label: string) => {
    const path = testInfo.outputPath(`${label}.png`);
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(label, { path, contentType: 'image/png' });
  };
  try {
    await resetRateLimits(page.request);
    const member = await signUpMember(page.request);
    // Freestyle is the one ranked ladder (ADR 0142).
    const ladder = 'freestyle';
    await page.goto('/play/room');
    await expect(
      page.getByRole('checkbox', { name: 'Ranked', exact: true }),
    ).not.toBeChecked();
    const room = await submitCreateRoom(
      page,
      `Ranked ${ladder} ${createId().slice(0, 8)}`,
      ladder,
      true,
    );
    const rooms = [{ ladder, id: room.id }];
    try {
      expect(room.competitionType).toBe('ranked');
      expect(room.formatId).toBe(ladder);
      // Ranked Freestyle always strikes its resolution before launch.
      expect(room.executionPlan.resolutionDraw.enabled).toBe(true);
      await expect(page.getByRole('heading').first()).toBeVisible();
      // There is no ladder chooser: a stale ?ladder= still reads Freestyle.
      await page.goto('/leaderboard?ladder=policy');
      await expect(
        page.getByRole('heading', { name: 'Leaderboard', exact: true }),
      ).toBeVisible();
      await page.goto('/leaderboard/seasons?ladder=value');
      // The season card names the season alone; no ladder (ADR 0156).
      await expect(
        page.getByRole('heading', { level: 2, name: 'Season 1', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText('One ladder per season', { exact: true }),
      ).toBeVisible();
    } finally {
      await closeRoom(page.request, room.id);
    }
    const evidence = await new Promise<
      readonly {
        ladder: RatingStyle;
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
        (error, output, stderr) =>
          error
            ? reject(new Error(`Rating display fixture refused: ${stderr}`))
            : resolve(JSON.parse(output)),
      );
      child.stdin?.end(JSON.stringify({ username: member.username, rooms }));
    });
    for (const row of evidence) {
      await page.goto(`/leaderboard?status=everyone&q=${member.username}`);
      await expect(
        page.getByRole('link', {
          name: `@${member.username}, provisional, rating ${row.rating}`,
          exact: true,
        }),
      ).toBeVisible();
      await capture(`${row.ladder}-leaderboard`);
      await page.goto(`/profile/${member.username}`);
      const ratings = page.getByRole('region', {
        name: 'Ratings',
        exact: true,
      });
      await expect(ratings).toContainText(`${row.rating}*`);
      await capture(`${row.ladder}-profile`);
      await page.goto(`/rounds/${row.roundId}`);
      // YRoundResult: the rating, then its change; no ladder is named (ADR 0156).
      await expect(
        page.getByRole('region', { name: 'Round ratings', exact: true }),
      ).toContainText(`${row.rating}* +${row.delta}`);
      await capture(`${row.ladder}-round-rating`);
    }
    await page.goto('/leaderboard/privacy');
    await expect(
      page.getByText('Your privacy settings', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(/Room visibility does not turn off rating/),
    ).toBeVisible();
    await page.goto('/settings');
    await expect(
      page.getByRole('checkbox', {
        name: 'Appear on the public ladder',
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});
