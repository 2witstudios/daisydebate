import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from './support/fixtures';
import { origin, signUpMember } from './support/accounts';
import { readBallotRound } from './support/human-ballot-round';

const fixture = async (input: Record<string, unknown>) => {
  const { stdout } = await promisify(execFile)(
    'bun',
    [
      resolve(import.meta.dirname, 'support/analysis-fixture-process.ts'),
      JSON.stringify(input),
    ],
    {
      cwd: resolve(import.meta.dirname, '../../..'),
      env: process.env,
      timeout: 20_000,
      maxBuffer: 4096,
    },
  );
  return JSON.parse(stdout) as {
    roundId: string;
    kind: string | null;
    request_id: string | null;
    calls: number | null;
    usage: string | null;
    source: string | null;
  };
};

test.describe('requested Round analysis without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('native requests reuse one identity, retain delivered reports after lapse and enforce one lifetime free use', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const own = await signUpMember(page.request);
    const other = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: false,
    });
    const stranger = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: false,
    });
    try {
      const opponent = await signUpMember(other.request);
      await signUpMember(stranger.request);
      const create = async () =>
        (
          await fixture({
            kind: 'create',
            affirmative: own.username,
            negative: opponent.username,
          })
        ).roundId;
      const inspect = (roundId: string) =>
        fixture({ kind: 'inspect', roundId, username: own.username });
      const report = page.getByRole('region', { name: 'Your round analysis' });
      const readReport = async () => {
        await expect(async () => {
          await page.reload();
          await expect(
            report.getByText(
              'You set up the access contention well and then let it drop.',
              { exact: true },
            ),
          ).toBeVisible();
        }).toPass({ timeout: 20_000 });
      };
      const includedRound = await create();
      await readBallotRound(page.request, includedRound);
      await page.goto(`/rounds/${includedRound}`);
      await expect(
        report.getByRole('button', { name: 'Request analysis', exact: true }),
      ).toBeVisible();
      expect((await inspect(includedRound)).kind).toBeNull();
      const post = (roundId: string) =>
        page.request.post(`/api/rounds/${roundId}/round-analysis`, {
          headers: { origin },
          data: '',
          maxRedirects: 0,
        });
      await report
        .getByRole('button', { name: 'Request analysis', exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/rounds/${includedRound}#round-analysis$`),
      );
      const duplicates = await Promise.all([
        post(includedRound),
        post(includedRound),
      ]);
      expect(duplicates.map((r) => r.status())).toEqual([303, 303]);
      await readReport();
      const included = await inspect(includedRound);
      expect(included).toMatchObject({
        kind: 'succeeded',
        calls: 1,
        usage: 'delivered',
        source: 'beta',
      });
      expect(included.request_id).toEqual(expect.any(String));

      await fixture({ kind: 'lapse', username: own.username });
      await page.reload();
      await expect(
        report.getByRole('heading', { name: 'How to get better' }),
      ).toBeVisible();
      expect((await post(includedRound)).status()).toBe(303);
      expect(await inspect(includedRound)).toEqual(included);
      const denied = await stranger.request.get(
        `/api/rounds/${includedRound}/round-analysis`,
      );
      expect(denied.status()).toBe(404);
      const deniedWrite = await stranger.request.post(
        `/api/rounds/${includedRound}/round-analysis`,
        { headers: { origin }, data: '', maxRedirects: 0 },
      );
      expect(deniedWrite.status()).toBe(404);
      expect(await inspect(includedRound)).toEqual(included);

      const freeRound = await create();
      await page.goto(`/rounds/${freeRound}`);
      await expect(report).toContainText('free');
      await report
        .getByRole('button', { name: 'Request analysis', exact: true })
        .click();
      await readReport();
      expect(await inspect(freeRound)).toMatchObject({
        kind: 'succeeded',
        calls: 1,
        usage: 'delivered',
        source: 'lifetime',
      });
      const lockedRound = await create();
      await page.goto(`/rounds/${lockedRound}`);
      await expect(
        report.getByRole('button', { name: 'Request analysis', exact: true }),
      ).toHaveCount(0);
      await expect(
        report.getByRole('link', { name: 'See Premium', exact: true }),
      ).toBeVisible();
      expect((await post(lockedRound)).status()).toBe(409);
      expect((await inspect(lockedRound)).kind).toBeNull();
      // A forged native post is refused through the same operation, with a server-rendered notice.
      const refused = await page.request.post(
        `/api/rounds/${lockedRound}/round-analysis`,
        { headers: { origin, accept: 'text/html' }, data: '', maxRedirects: 0 },
      );
      expect(refused.status()).toBe(303);
      await page.goto(refused.headers().location!);
      await expect(report.getByRole('status')).toContainText(
        'could not be accepted',
      );
      await report
        .getByRole('link', { name: 'See Premium', exact: true })
        .click();
      await expect(
        page.getByRole('heading', { name: 'Daisy Premium', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText('Premium · USD 10/month', { exact: true }).first(),
      ).toBeVisible();
    } finally {
      await other.close();
      await stranger.close();
    }
  });
});
