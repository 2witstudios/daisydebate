import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import { systemClock } from '@daisy/clock';
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

const contextFor = (browser: Browser, javaScriptEnabled = true) =>
  browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    javaScriptEnabled,
  });

/** The lobby switch (YLLobbySwitch): two links, the current one marked. */
const lobbySwitch = (page: Page) =>
  page.getByRole('navigation', { name: 'Lobby', exact: true });

const expectLobby = async (page: Page, name: 'Open lobby' | 'Youth lobby') =>
  expect(
    lobbySwitch(page).getByRole('link', { name, exact: true }),
  ).toHaveAttribute('aria-current', 'page');

const lobbyRow = (page: Page, title: string) =>
  page
    .getByRole('region', { name: 'Available rooms' })
    .getByRole('listitem')
    .filter({ hasText: title });

test('each member lands in their own lobby and switches to the other, with and without script', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const contexts: BrowserContext[] = [];
  try {
    for (const javaScriptEnabled of [true, false]) {
      const adultContext = await contextFor(browser, javaScriptEnabled);
      const youthContext = await contextFor(browser, javaScriptEnabled);
      contexts.push(adultContext, youthContext);
      const adult = await openPage(adultContext, 'adult member');
      const youth = await openPage(youthContext, 'youth member');
      await resetRateLimits(adult.request);
      await signUpMember(adult.request);
      await signUpMember(youth.request, youthBirth(systemClock.now()));

      await adult.goto('/lobby');
      await expectLobby(adult, 'Open lobby');
      await youth.goto('/lobby');
      await expectLobby(youth, 'Youth lobby');

      await lobbySwitch(adult)
        .getByRole('link', { name: 'Youth lobby', exact: true })
        .click();
      await expect(adult).toHaveURL(/[?&]lobby=youth/);
      await expectLobby(adult, 'Youth lobby');
      await lobbySwitch(youth)
        .getByRole('link', { name: 'Open lobby', exact: true })
        .click();
      await expect(youth).toHaveURL(/[?&]lobby=open/);
      await expectLobby(youth, 'Open lobby');
      // The Division filter is gone: the lobby is the switch (ADR 0156).
      await expect(adult.locator('select[name="division"]')).toHaveCount(0);
    }
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('Watch from a row, and debater seats only for the Room’s own lobby', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  await openSeasons();
  const adultContext = await contextFor(browser);
  const youthContext = await contextFor(browser);
  const rooms: { readonly page: Page; readonly id: string }[] = [];
  try {
    const adult = await openPage(adultContext, 'adult host');
    const youth = await openPage(youthContext, 'youth host');
    await resetRateLimits(adult.request);
    await signUpMember(adult.request);
    await signUpMember(youth.request, youthBirth(systemClock.now()));

    // An Open Room, watched from the Youth member's view of the Open lobby.
    const openTitle = `Open room ${createId().slice(0, 8)}`;
    await adult.goto('/play/room');
    const openRoom = await submitCreateRoom(
      adult,
      openTitle,
      'freestyle',
      true,
    );
    rooms.push({ page: adult, id: openRoom.id });
    await claim(adult, openRoom, 'Affirmative 1');

    await youth.goto('/lobby?lobby=open');
    const row = lobbyRow(youth, openTitle);
    await expect(row).toHaveCount(1);
    await expect(
      row.getByRole('link', { name: `Watch: ${openTitle}` }),
    ).toBeVisible();
    await expect(
      row.getByRole('link', { name: `Join: ${openTitle}` }),
    ).toHaveCount(0);
    await expect(row).not.toContainText('Freestyle –');
    await row.getByRole('link', { name: `Watch: ${openTitle}` }).click();
    await expect(youth).toHaveURL(new RegExp(`/rooms/${openRoom.id}$`));

    // A minor is offered no Open debater seat, and may judge.
    const negative = rosterSeatName(
      await reread(youth.request, openRoom.id),
      'Negative 1',
    );
    await expect(
      youth.getByRole('button', { name: `Take ${negative}`, exact: true }),
    ).toHaveCount(0);
    await expect(
      youth.getByRole('button', { name: /^Take Judge/ }).first(),
    ).toBeVisible();

    // A Youth Room: an adult is offered no Youth debater seat.
    const youthTitle = `Youth room ${createId().slice(0, 8)}`;
    await youth.goto('/play/room');
    const youthRoom = await submitCreateRoom(
      youth,
      youthTitle,
      'freestyle',
      true,
    );
    rooms.push({ page: youth, id: youthRoom.id });
    await claim(youth, youthRoom, 'Affirmative 1');
    await adult.goto('/lobby?lobby=youth');
    const youthRow = lobbyRow(adult, youthTitle);
    await expect(
      youthRow.getByRole('link', { name: `Watch: ${youthTitle}` }),
    ).toBeVisible();
    await expect(
      youthRow.getByRole('link', { name: `Join: ${youthTitle}` }),
    ).toHaveCount(0);
    await adult.goto(`/rooms/${youthRoom.id}`);
    const youthNegative = rosterSeatName(
      await reread(adult.request, youthRoom.id),
      'Negative 1',
    );
    await expect(
      adult.getByRole('button', { name: `Take ${youthNegative}`, exact: true }),
    ).toHaveCount(0);
    const after = await reread(adult.request, youthRoom.id);
    expect(after.division).toBe('youth');
  } finally {
    for (const room of rooms) await closeRoom(room.page.request, room.id);
    await adultContext.close();
    await youthContext.close();
  }
});
