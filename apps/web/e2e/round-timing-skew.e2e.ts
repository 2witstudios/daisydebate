/**
 * ISSUE-882: a debater's round display must advance from the server's own
 * read-backed sample plus monotonic elapsed time, never from the browser's
 * wall clock. Two humans, no bots, launch a real live Round; the journey
 * then bumps the browser's wall clock two minutes fast and proves the
 * displayed clock against the server's segment rows.
 */
import { origin } from './support/accounts';
import type { APIRequestContext } from '@playwright/test';
import { expect, openPage, test } from './support/fixtures';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { createProofRoom, claim } from './support/room-launch-flow';
import { closeSettledLaunchContexts } from './support/room-launch-settled';
import { roundViewSchema, type RoundView } from '@daisy/protocol';

const TWO_MINUTE_SKEW_MS = 120_000;
/** m:ss reads whole seconds; this journey allows one sweep of the clock face. */
const READING_TOLERANCE_MS = 5_000;
/** The launch minute before the first speech opens. */
const WAIT_FOR_ROUND_READ_MS = 60_000;

/* The monotonic instant this process measures: the only honest clock an e2e
   harness may read, since the browser's wall clock is this test's subject. */
const elapsedMs = () => performance.timeOrigin + performance.now();

/** The m:ss reading of a live round clock ("aria-label": label m:ss). */
const parseClock = (aria: string | null): number => {
  const [reading] = (aria?.split(' ') ?? []).slice(-1);
  if (!reading?.includes(':')) return Number.POSITIVE_INFINITY;
  const [minutes, seconds] = [
    Number(reading.split(':')[0]),
    Number(reading.split(':')[1]),
  ];
  if (!Number.isInteger(minutes) || !Number.isInteger(seconds))
    return Number.POSITIVE_INFINITY;
  return minutes * 60_000 + seconds * 1000;
};

/** The newest stored segment row's remaining duration, from the server's own rows. */
const openSegmentRemaining = (view: RoundView, atMs: number) => {
  const row = view.segments.at(-1);
  if (!row || row.endedAt !== null) return null;
  return Date.parse(row.startedAt) + row.durationMs - atMs;
};

/** Read the round until it stores one open segment, with generous patience. */
const readTheOpenRound = async (
  request: APIRequestContext,
  roundId: string,
): Promise<{ readonly view: RoundView; readonly readAtMs: number }> => {
  const started = elapsedMs();
  for (;;) {
    const response = await request.get(`/api/rounds/${roundId}`);
    expect(response.status()).toBe(200);
    const view = roundViewSchema.parse(await response.json());
    const readAtMs = elapsedMs();
    if (openSegmentRemaining(view, readAtMs) !== null)
      return { view, readAtMs };
    if (view.status === 'completed')
      throw new Error('The round ended before the journey checked its display');
    if (elapsedMs() - started > WAIT_FOR_ROUND_READ_MS)
      throw new Error('The round never opened its first speech in the window');
    await new Promise((resume) => setTimeout(resume, 1_000));
  }
};

test('a live debater clock reads the server read, not the adjusted browser wall clock', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  let roundId: string | undefined;
  try {
    // Both sides are real humans, so no bot-availability gate is in the way.
    for (const { context } of accounts.members)
      await context.grantPermissions(['camera', 'microphone'], { origin });
    const host = await openPage(accounts.members[0]!.context, 'skew host');
    const guest = await openPage(accounts.members[1]!.context, 'skew guest');
    const seed = await createProofRoom(host, 'Timing skew proof');
    await claim(host, seed, 'Affirmative 1');
    await claim(guest, seed, 'Negative 1');
    await host.reload();
    for (const page of [host, guest]) {
      await page.getByRole('button', { name: 'Check camera', exact: true }).click();
      await expect(page.getByText('✓ Camera', { exact: true })).toBeVisible();
      await page
        .getByRole('button', { name: 'Check microphone', exact: true })
        .click();
      await expect(
        page.getByText('✓ Microphone', { exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'I’m ready', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Not ready', exact: true }),
      ).toBeEnabled();
    }
    await expect(
      host.getByRole('button', { name: 'Start round', exact: true }),
    ).toBeEnabled();
    await host.getByRole('button', { name: 'Start round', exact: true }).click();
    await expect(host).toHaveURL(/\/rounds\/[a-z0-9]+\/room$/);
    roundId = new URL(host.url()).pathname.split('/').at(-2)!;
    await expect(guest).toHaveURL(host.url());

    // This round room's browser session now reports a wall clock two minutes
    // fast. A display computed from raw wall time would drift, hanging the
    // whole round by the skew; the server read and monotonic elapsed keep it
    // pinned to authority.
    await host.clock.setSystemTime(elapsedMs() + TWO_MINUTE_SKEW_MS);
    const { view, readAtMs } = await readTheOpenRound(
      accounts.members[0]!.context.request,
      roundId,
    );
    expect(
      ['active'].includes(view.status),
      `${roundId} is live with a stored ${view.segments.length} row(s)`,
    ).toBe(true);
    expect(view.rules.segments.length).toBeGreaterThan(0);
    const remainingAtRead = openSegmentRemaining(view, readAtMs)!;
    expect(
      remainingAtRead > 0,
      `the open segment has ${remainingAtRead} ms left on read`,
    ).toBe(true);
    await expect
      .poll(
        async () => {
          const aria = await host
            .getByRole('timer')
            .getAttribute('aria-label');
          const displayed = parseClock(aria);
          const latest = openSegmentRemaining(
            roundViewSchema.parse(
              await (
                await accounts.members[0]!.context.request.get(
                  `/api/rounds/${roundId}`,
                )
              ).json(),
            ),
            elapsedMs(),
          );
          if (displayed === Number.POSITIVE_INFINITY || latest === null)
            return Number.POSITIVE_INFINITY; // keep polling until both are in place
          return Math.abs(displayed - latest);
        },
        { timeout: WAIT_FOR_ROUND_READ_MS },
      )
      .toBeLessThan(READING_TOLERANCE_MS);
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});
