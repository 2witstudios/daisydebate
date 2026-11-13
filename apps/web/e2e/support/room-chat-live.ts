import type { Page } from '@playwright/test';
import { expect, openPage, test } from './fixtures';
import { origin, signUpMember } from './accounts';
import { createLaunchContexts } from './room-launch-contexts';
import {
  claimSeat,
  createFoundationRoom,
  readyOwnSeat,
  startAdmittedRound,
} from './human-ballot-round';
import { humanRoundSelection } from './human-round-selection';
import { settleLeftRounds } from './settle-left-round';

const chat = (page: Page) =>
  page.getByRole('region', { name: 'Room chat', exact: true });
const composer = (page: Page) =>
  chat(page).getByRole('textbox', {
    name: 'Message everyone in the room',
    exact: true,
  });
/** The row of one message: its author line is the row's first paragraph. */
const row = (page: Page, text: string) =>
  chat(page)
    .getByRole('list', { name: 'Room chat messages' })
    .getByRole('listitem')
    .filter({ hasText: text });
const author = (page: Page, text: string) =>
  row(page, text).getByRole('paragraph').first();

async function post(page: Page, text: string) {
  await expect(composer(page)).toBeEditable();
  await composer(page).fill(text);
  await chat(page)
    .getByRole('button', { name: 'Send message', exact: true })
    .click();
  await expect(row(page, text)).toBeVisible();
}

/** A mark a navigation or reload would lose: what arrives after it arrived on this document. */
const markDocument = (page: Page) =>
  page.evaluate(() => {
    (window as Window & { roomChatProof?: true }).roomChatProof = true;
  });
const sameDocument = (page: Page) =>
  page.evaluate(
    () => (window as Window & { roomChatProof?: true }).roomChatProof === true,
  );

/**
 * RCHAT-15: Room chat between a seat and a visitor, on the real web and
 * realtime processes. Without a socket a thread is its server render and
 * never live, so this belongs to the realtime proof
 * (from realtime-room-delivery.e2e.ts).
 */
export function testRoomChatLive() {
  test('Room chat reaches a seated host and a seatless visitor without reload, names only the seat, and is gone after Start', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const accounts = await createLaunchContexts(
      3,
      () => browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true }),
      (context) => signUpMember(context.request),
    );
    const [host, visitor, opponent] = accounts.members;
    if (!host || !visitor || !opponent)
      throw new Error('Room chat proof needs three members');
    try {
      // A public casual Room; the host holds a seat, the visitor never does.
      let room = await createFoundationRoom(host, (proof) =>
        humanRoundSelection(proof, 0),
      );
      room = await claimSeat(host, room, { role: 'affirmative', slot: 0 });
      const address = `/api/rooms/${room.id}/chat`;

      const hostPage = await openPage(host.context, 'Room chat seated host');
      const visitorPage = await openPage(visitor.context, 'Room chat visitor');
      await hostPage.goto(`/rooms/${room.id}`);
      await visitorPage.goto(`/rooms/${room.id}`);
      for (const page of [hostPage, visitorPage]) {
        await expect(
          chat(page).getByRole('heading', { name: 'Room chat', exact: true }),
        ).toBeVisible();
        await markDocument(page);
      }
      // RCHAT-9: devices belong to a seat; a visitor has the chat alone.
      const devices = (page: Page) =>
        page.getByRole('region', { name: 'Your devices', exact: true });
      await expect(devices(hostPage)).toBeVisible();
      await expect(devices(visitorPage)).toHaveCount(0);

      // RCHAT-7: each side's message reaches the other open tab.
      const fromVisitor = 'A visitor asks when this starts';
      const fromHost = 'The host answers: in two minutes';
      await post(visitorPage, fromVisitor);
      await expect(row(hostPage, fromVisitor)).toBeVisible();
      await post(hostPage, fromHost);
      await expect(row(visitorPage, fromHost)).toBeVisible();

      // RCHAT-10: the seat and host mark beside a seated author, nothing
      // beside a visitor, on either page.
      await expect(author(visitorPage, fromHost)).toHaveText(
        `${host.username} · Affirmative 1 · host`,
      );
      await expect(author(hostPage, fromHost)).toHaveText(
        'You · Affirmative 1 · host',
      );
      await expect(author(hostPage, fromVisitor)).toHaveText(visitor.username);
      await expect(author(visitorPage, fromVisitor)).toHaveText('You');
      expect([
        await sameDocument(hostPage),
        await sameDocument(visitorPage),
      ]).toEqual([true, true]);
      expect((await visitor.context.request.get(address)).status()).toBe(200);

      // Start: a third member takes the other side, both seats Ready.
      room = await claimSeat(opponent, room, { role: 'negative', slot: 0 });
      room = await readyOwnSeat(host, room, { role: 'affirmative', slot: 0 });
      room = await readyOwnSeat(opponent, room, { role: 'negative', slot: 0 });
      await startAdmittedRound(host, room);

      // RCHAT-4: the visitor's open tab drops the chat, and its address is
      // no longer theirs to read.
      await expect(chat(visitorPage)).toHaveCount(0, { timeout: 20_000 });
      expect((await visitor.context.request.get(address)).status()).toBe(404);
    } finally {
      await settleLeftRounds([host, opponent]);
      await accounts.closeContexts();
    }
  });
}
