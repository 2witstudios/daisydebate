import { readBallotRound } from './support/human-ballot-round';
import { expect, test } from './support/round-files';

test('a live debater clock stays server-authoritative with an adjusted wall clock', async ({
  roundFiles,
}) => {
  const { page, roundId, stranger } = roundFiles;
  // This browser session reports a wall clock two minutes fast. A client
  // rendering from raw wall time would overdraw the round: this journey keeps
  // the display pinned to the server read and monotonic elapsed only (ISSUE-882).
  await page.addInitScript(() => {
    const real = Date.now.bind(Date);
    Date.now = () => real() + 120_000;
  });
  await page.reload();
  await expect(page.getByRole('timer')).toBeVisible({ timeout: 30_000 });
  const view = await readBallotRound(stranger.request, roundId);
  const open = view.segments.at(-1);
  if (!open || open.endedAt !== null)
    throw new Error('No open round segment during the room check');
  const remainingServerMs =
    Date.parse(view.startedAt ?? '') +
    view.rules.segments.reduce((total, segment) => total + segment.durationMs, 0) -
    Date.now();
  if (remainingServerMs <= 0) throw new Error('Round ended before the check');
  await expect
    .poll(async () => {
      const aria = await page.getByRole('timer').getAttribute('aria-label');
      if (!aria) return Number.POSITIVE_INFINITY;
      const [reading] = aria.split(' ').toReversed();
      if (!reading?.includes(':')) return Number.POSITIVE_INFINITY;
      const [minutes, seconds] = reading.split(':').map(Number);
      if (!Number.isInteger(minutes) || !Number.isInteger(seconds))
        return Number.POSITIVE_INFINITY;
      return (minutes * 60 + seconds) * 1000;
    })
    .toBeLessThanOrEqual(remainingServerMs + 5000);
});
