import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createId } from '@paralleldrive/cuid2';
import { systemClock } from '@daisy/clock';
import type { Page } from '@playwright/test';
import { expect, openPage, test } from './support/fixtures';
import {
  origin,
  resetRateLimits,
  signUpMember,
  youthBirth,
} from './support/accounts';
import { claim, closeRoom, submitCreateRoom } from './support/room-launch-flow';

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

const notice = 'Only people in this Room can chat here.';
const chatOf = (page: Page) =>
  page.getByRole('region', { name: 'Room chat', exact: true });

test('a seatless member reads a Youth Room’s chat and has nowhere to post (decision 84)', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openSeasons();
  const contexts = {
    youth: await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
    }),
    adult: await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
    }),
  };
  let roomId: string | undefined;
  let host: Page | undefined;
  try {
    host = await openPage(contexts.youth, 'youth host');
    const adult = await openPage(contexts.adult, 'adult spectator');
    await resetRateLimits(host.request);
    await signUpMember(host.request, youthBirth(systemClock.now()));
    await signUpMember(adult.request);
    await host.goto('/play/room');
    const created = await submitCreateRoom(
      host,
      `Youth chat ${createId().slice(0, 8)}`,
      'freestyle',
      true,
    );
    roomId = created.id;
    // A minor creates it, so it is a Youth Room (ADR 0156); seated, their page opens its chat.
    const seated = await claim(host, created, 'Affirmative 1');
    expect(seated.ageRule).toBe('under-18');
    await expect(
      chatOf(host).getByRole('textbox', {
        name: 'Message everyone in the room',
      }),
    ).toBeVisible();
    await expect(chatOf(host)).not.toContainText(notice);

    await adult.goto(`/rooms/${created.id}`);
    const chat = chatOf(adult);
    await expect(chat).toContainText(notice);
    await expect(chat.getByRole('textbox')).toHaveCount(0);
    await expect(chat.locator('form')).toHaveCount(0);
    // The notice names a seat, never an age or a judge.
    await expect(chat).not.toContainText(/under 18|\bage\b|Judges read/i);
  } finally {
    if (roomId && host) await closeRoom(host.request, roomId);
    for (const context of Object.values(contexts)) await context.close();
  }
});
