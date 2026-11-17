import type { Browser, Page } from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import { isNamedSeat, roomViewSchema, type DebateSide } from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { origin } from './accounts';
import { foundationSelection } from '../../integration/foundation-selection.test-support';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import {
  claim,
  readyUp,
  reread,
  startRoundInBrowser,
} from './room-launch-flow';
import { readBallotRound } from './human-ballot-round';
import { closeSettledLaunchContexts } from './room-launch-settled';

const sideOf: Readonly<Record<string, DebateSide>> = {
  Affirmative: 'affirmative',
  Negative: 'negative',
};

/**
 * The opening's sides card as one page reads it: the side its headline gives
 * this viewer and the debaters listed under each side.
 */
async function readSidesCard(page: Page) {
  const card = page.getByRole('region', {
    name: /^You're (Affirmative|Negative)$/,
  });
  await expect(card).toBeVisible();
  await expect(card.getByText('Coin flip', { exact: true })).toBeVisible();
  const headline = (
    await card.getByRole('heading', { level: 2 }).innerText()
  ).trim();
  const column = async (side: 'Affirmative' | 'Negative') =>
    (
      await card
        .getByRole('heading', { level: 3, name: side, exact: true })
        .locator('xpath=..')
        .getByRole('listitem')
        .allInnerTexts()
    ).join('\n');
  return {
    mine: sideOf[headline.replace(/^You're /, '')]!,
    affirmative: await column('Affirmative'),
    negative: await column('Negative'),
  };
}

/**
 * SEAT-13 (ADR 0145): a new Room's sides are open. Two debaters sit with
 * their sides on ?, both Ready, and the host's Start round flips the coin:
 * each page's opening names that viewer's side, the two are opposite, and
 * both cards list the same debaters on the same sides as the Round itself.
 */
export async function proveCoinFlip(browser: Browser) {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    for (const { context } of accounts.members)
      await context.grantPermissions(['camera', 'microphone'], { origin });
    const [hostMember, guestMember] = accounts.members as [
      (typeof accounts.members)[number],
      (typeof accounts.members)[number],
    ];
    const host = await openPage(hostMember.context, 'coin flip host');
    const guest = await openPage(guestMember.context, 'coin flip guest');
    // Prep before the round holds the Round in its opening long enough to
    // read the sides card; the Room states no sides, so they are open.
    const created = await host.request.post('/api/rooms', {
      headers: { origin },
      data: {
        commandId: createId(),
        title: `Coin flip ${createId().slice(0, 8)}`,
        resolution: { kind: 'custom', text: 'Cities should fund transit' },
        visibility: 'public',
        selection: {
          ...foundationSelection,
          definition: {
            ...foundationSelection.definition,
            configurable: {
              ...foundationSelection.definition.configurable,
              preRoundPrep: { durationMs: { min: 30_000, max: 120_000 } },
            },
          },
          config: {
            ...foundationSelection.config,
            preRoundPrep: { enabled: true, durationMs: 60_000 },
          },
        },
      },
    });
    expect(created.status()).toBe(201);
    let view = roomViewSchema.parse((await created.json()).view);
    expect(view.teamOneSide).toBeNull();
    view = await claim(host, view, 'Affirmative 1');
    view = await claim(guest, view, 'Negative 1');
    await host.reload();
    const names = {
      host: hostMember.username,
      guest: guestMember.username,
    };
    // Both rows read ? on both pages: the coin decides at Start round.
    for (const page of [host, guest])
      for (const name of [names.host, names.guest])
        await expect(
          page
            .getByRole('listitem', { name, exact: true })
            .getByLabel(`${name}'s side: coin flip`, { exact: true }),
        ).toBeVisible();
    await readyUp(host);
    await readyUp(guest);
    await expect(async () => {
      view = await reread(host.request, view.id);
      expect(view.capabilities.canStart).toBe(true);
    }).toPass({ timeout: 10_000 });
    expect(view.teamOneSide).toBeNull();
    const roundId = await startRoundInBrowser(host);
    await expect(guest).toHaveURL(host.url());

    const [hostCard, guestCard] = await Promise.all([
      readSidesCard(host),
      readSidesCard(guest),
    ]);
    // Opposite sides, one for each debater.
    expect([hostCard.mine, guestCard.mine].sort()).toEqual([
      'affirmative',
      'negative',
    ]);
    const affirmative =
      hostCard.mine === 'affirmative' ? names.host : names.guest;
    const negative = affirmative === names.host ? names.guest : names.host;
    // Both pages agree on who argues which side.
    for (const card of [hostCard, guestCard]) {
      expect(card.affirmative).toContain(affirmative);
      expect(card.affirmative).not.toContain(negative);
      expect(card.negative).toContain(negative);
      expect(card.negative).not.toContain(affirmative);
    }
    // And they read the Round's own seats: the coin's result is durable.
    const round = await readBallotRound(host.request, roundId);
    expect(round.opening?.sides?.coin).not.toBeNull();
    const roleOf = (actorId: string) =>
      round.participants
        .filter(isNamedSeat)
        .find((seat) => seat.actorId === actorId)?.role;
    const started = await reread(host.request, view.id);
    expect(roleOf(started.hostActorId!)).toBe(hostCard.mine);
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
}
