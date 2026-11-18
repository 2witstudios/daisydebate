import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createId } from '@paralleldrive/cuid2';
import { expect, openPage, test } from './support/fixtures';
import {
  origin,
  resetRateLimits,
  signUpMember,
  youthBirth,
} from './support/accounts';
import {
  claim,
  closeRoom,
  reread,
  rosterSeatName,
  submitCreateRoom,
} from './support/room-launch-flow';

/** Each division's Season 1, as the operator opens them (ADR 0147). */
const openSeasons = () =>
  new Promise<void>((resolve, reject) =>
    execFile(
      'bun',
      [
        fileURLToPath(
          new URL('./support/rating-season-worker.ts', import.meta.url),
        ),
      ],
      { timeout: 20_000 },
      (error) =>
        error ? reject(new Error('Rating season setup refused')) : resolve(),
    ),
  );

test('the lobby names a ranked Room’s ladder, and a minor’s Open debater seat says why', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openSeasons();
  const adultContext = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  const youthContext = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  let roomId: string | undefined;
  try {
    const adult = await openPage(adultContext, 'adult host');
    const youth = await openPage(youthContext, 'youth member');
    await resetRateLimits(adult.request);
    await signUpMember(adult.request);
    await signUpMember(youth.request, youthBirth());
    const title = `Open ladder ${createId().slice(0, 8)}`;
    await adult.goto('/play/room');
    const created = await submitCreateRoom(adult, title, 'freestyle', true);
    roomId = created.id;
    // The adult sits first, so the Room's ladder is Open – Freestyle.
    const seated = await claim(adult, created, 'Affirmative 1');
    expect(seated.ladder).toBe('open');

    await youth.goto('/lobby');
    const row = youth
      .getByRole('region', { name: 'Available rooms' })
      .getByRole('listitem')
      .filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Open – Freestyle');
    await expect(row).toContainText(
      /Judge seat open to everyone\.|Debater seats: 18 and over\./,
    );

    await youth.goto(`/rooms/${created.id}`);
    const negative = rosterSeatName(
      await reread(youth.request, created.id),
      'Negative 1',
    );
    await youth
      .getByRole('button', { name: `Take ${negative}`, exact: true })
      .click();
    await expect(
      youth.getByText('That seat is for a debater 18 and over.'),
    ).toBeVisible();
    const after = await reread(youth.request, created.id);
    expect(
      after.participants.filter((p) => 'actorId' in p && p.kind === 'human')
        .length,
    ).toBe(1);
  } finally {
    if (roomId) {
      const host = adultContext.pages()[0];
      if (host) await closeRoom(host.request, roomId);
    }
    await adultContext.close();
    await youthContext.close();
  }
});
