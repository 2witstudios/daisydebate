import { drawCapableBounds } from '@daisy/protocol/testing';
import { createId } from '@paralleldrive/cuid2';
import {
  roomCatalogChoiceSchema,
  roomViewSchema,
  type RoomView,
} from '@daisy/protocol';
import { expect, openPage, test } from './support/fixtures';
import { origin } from './support/accounts';
import { foundationSelection } from '../integration/foundation-selection.test-support';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import {
  assignSeat,
  claimSeat,
  readyOwnSeat,
  startAdmittedRound,
} from './support/human-ballot-round';
import { roomCastChoiceSchema } from '@daisy/protocol';

const SENTINEL = 'E2E-STRIKE-LINE';
const lines = ['alpha', 'bravo', 'charlie'].map((w) => `${SENTINEL} ${w}`);

/** A casual custom Room on the proof schedule with a three-line host draw. */
async function createDrawRoom(
  request: import('@playwright/test').APIRequestContext,
) {
  const created = await request.post('/api/rooms', {
    headers: { origin },
    data: {
      commandId: createId(),
      title: `Strike proof ${createId().slice(0, 8)}`,
      topic: null,
      visibility: 'public',
      selection: {
        kind: 'custom',
        competitionType: 'casual',
        definition: {
          ...foundationSelection.definition,
          configurable: {
            ...foundationSelection.definition.configurable,
            resolutionDraw: drawCapableBounds,
          },
        },
        config: {
          ...foundationSelection.config,
          preRoundPrep: { enabled: false },
          resolutionDraw: {
            enabled: true,
            drawSize: 3,
            strikeWindowMs: 180_000,
            firstStriker: 'negative',
            source: { kind: 'host', resolutions: lines },
          },
        },
      },
    },
  });
  expect(created.status()).toBe(201);
  return roomViewSchema.parse((await created.json()).view);
}

const command = async (
  request: import('@playwright/test').APIRequestContext,
  view: RoomView,
  body: object,
) => {
  const response = await request.post(`/api/rooms/${view.id}/commands`, {
    headers: { origin },
    data: { ...body, commandId: createId(), expectedVersion: view.version },
  });
  expect(response.status()).toBe(200);
  return roomViewSchema.parse((await response.json()).view);
};

test('debaters strike to one resolution without JavaScript while a spectator never receives a drawn line first', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 3);
  const [host, guest, watcher] = accounts.members as [
    (typeof accounts.members)[number],
    (typeof accounts.members)[number],
    (typeof accounts.members)[number],
  ];
  let view = await createDrawRoom(host.context.request);
  view = await claimSeat(host, view, { role: 'affirmative', slot: 0 });
  view = await claimSeat(guest, view, { role: 'negative', slot: 0 });
  await readyOwnSeat(host, view, { role: 'affirmative', slot: 0 });
  view = await readyOwnSeat(guest, view, { role: 'negative', slot: 0 });
  view = await command(host.context.request, view, { type: 'start-pre-round' });

  const spectator = await openPage(watcher.context, 'Strike spectator');
  await spectator.goto(`/rooms/${view.id}`);
  await expect(
    spectator.getByText('Hidden until the debaters finish striking'),
  ).toBeVisible();
  expect(await spectator.content()).not.toContain(SENTINEL);

  // The Negative strikes first with scripts off: a native POST and a fresh page.
  const noScript = await browser.newContext({
    baseURL: origin,
    javaScriptEnabled: false,
    storageState: await guest.context.storageState(),
  });
  try {
    const negative = await openPage(noScript, 'Strike negative, no JavaScript');
    await negative.goto(`/rooms/${view.id}`);
    await expect(
      negative.getByRole('heading', {
        name: 'Your turn: strike a resolution you don’t want to debate',
      }),
    ).toBeVisible();
    await negative.getByRole('radio').first().check();
    await negative
      .getByRole('button', { name: 'Strike this resolution' })
      .click();
    await expect(negative.getByText('You struck this')).toBeVisible();
  } finally {
    await noScript.close();
  }

  const affirmative = await openPage(host.context, 'Strike host');
  await affirmative.goto(`/rooms/${view.id}`);
  await expect(
    affirmative.getByRole('heading', {
      name: 'Your turn: strike a resolution you don’t want to debate',
    }),
  ).toBeVisible();
  await affirmative.getByRole('radio', { disabled: false }).first().check();
  await affirmative
    .getByRole('button', { name: 'Strike this resolution' })
    .click();

  const revealed = async () =>
    roomViewSchema.parse(
      await (await watcher.context.request.get(`/api/rooms/${view.id}`)).json(),
    );
  await expect(async () => {
    expect((await revealed()).topic).not.toBeNull();
  }).toPass();
  const survivor = (await revealed()).topic!;
  expect(lines).toContain(survivor);
  await spectator.reload();
  await expect(spectator.getByText(survivor)).toBeVisible();
  const html = await spectator.content();
  for (const line of lines.filter((line) => line !== survivor))
    expect(html).not.toContain(line);

  const ready = roomViewSchema.parse(
    await (await host.context.request.get(`/api/rooms/${view.id}`)).json(),
  );
  const round = await startAdmittedRound(host, ready);
  expect(round.topic).toBe(survivor);
});

test('a Freestyle bank strike against a bot: automatic strikes, a strike in the browser, a time-out, the reveal, prep and Launch', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const host = accounts.members[0]!;
    const catalog = await (
      await host.context.request.get('/api/rooms/catalog')
    ).json();
    const freestyle = catalog.choices
      .map((c: unknown) => roomCatalogChoiceSchema.parse(c))
      .find((c: { formatId: string }) => c.formatId === 'freestyle');
    if (!freestyle) throw new Error('Freestyle missing from the catalog');
    const bots = catalog.bots
      .map((bot: unknown) => roomCastChoiceSchema.parse(bot))
      .filter((bot: { eligible: boolean }) => bot.eligible);
    expect(bots.length).toBeGreaterThanOrEqual(2);
    const created = await host.context.request.post('/api/rooms', {
      headers: { origin },
      data: {
        commandId: createId(),
        title: `Freestyle proof ${createId().slice(0, 8)}`,
        topic: null,
        visibility: 'public',
        selection: {
          kind: 'catalog',
          formatId: freestyle.formatId,
          formatVersion: freestyle.formatVersion,
          presetVersion: freestyle.preset.version,
          competitionType: 'casual',
        },
      },
    });
    expect(created.status()).toBe(201);
    let view = roomViewSchema.parse((await created.json()).view);
    view = await claimSeat(host, view, { role: 'affirmative', slot: 0 });
    view = await assignSeat(host, view, {
      actorId: bots[0]!.actorId,
      role: 'negative',
      slot: 0,
    });
    view = await assignSeat(host, view, {
      actorId: bots[1]!.actorId,
      role: 'judge',
      slot: 0,
    });
    view = await readyOwnSeat(host, view, { role: 'affirmative', slot: 0 });
    view = await command(host.context.request, view, {
      type: 'start-pre-round',
    });

    // The bot side strikes on its own; the page rereads at each due instant.
    const page = await openPage(host.context, 'Freestyle strike host');
    await page.goto(`/rooms/${view.id}`);
    const myTurn = page.getByRole('heading', {
      name: 'Your turn: strike a resolution you don’t want to debate',
    });
    await expect(myTurn).toBeVisible({ timeout: 20_000 });
    await page.getByRole('radio', { disabled: false }).first().check();
    await page.getByRole('button', { name: 'Strike this resolution' }).click();
    await expect(page.getByText('You struck this')).toBeVisible();

    // The second human turn runs out: Daisy strikes, and the last one left is revealed.
    await expect(myTurn).toBeVisible({ timeout: 20_000 });
    const read = async () =>
      roomViewSchema.parse(
        await (await host.context.request.get(`/api/rooms/${view.id}`)).json(),
      );
    await expect(async () => {
      expect((await read()).topic).not.toBeNull();
    }).toPass({ timeout: 120_000 });
    const revealedView = await read();
    const survivor = revealedView.topic!;
    await expect(page.getByText(survivor).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByText('How it was chosen').click();
    await expect(
      page.getByText('Daisy struck this for you · time ran out'),
    ).toBeVisible();
    expect(revealedView.prep.startedAt).toBe(
      revealedView.resolutionDraw?.revealedAt,
    );

    const prepped = await command(host.context.request, revealedView, {
      type: 'finish-prep',
    });
    const round = await startAdmittedRound(host, prepped);
    expect(round.topic).toBe(survivor);
  } finally {
    await accounts.closeContexts();
  }
});
