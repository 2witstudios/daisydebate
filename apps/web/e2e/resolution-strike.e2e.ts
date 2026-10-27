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
import { readyUp, startRoundInBrowser } from './support/room-launch-flow';
import {
  assignSeat,
  claimSeat,
  readBallotRound,
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
            // The floor of the draw-capable bounds: a time-out takes 15 s, not minutes.
            strikeWindowMs: 15_000,
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

/** A no-JavaScript page on a member's own session; the caller closes the context. */
const noScriptPage = async (
  browser: import('@playwright/test').Browser,
  member: { readonly context: import('@playwright/test').BrowserContext },
  name: string,
) => {
  const context = await browser.newContext({
    baseURL: origin,
    javaScriptEnabled: false,
    storageState: await member.context.storageState(),
  });
  return { context, page: await openPage(context, name) };
};

const yourTurn = 'Your turn: strike a resolution you don’t want to debate';

test('debaters strike to one resolution without JavaScript while a spectator never receives a drawn line first', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const accounts = await createRoomLaunchAccounts(browser, 3);
  const opened: import('@playwright/test').BrowserContext[] = [];
  try {
    const [host, guest, watcher] = accounts.members as [
      (typeof accounts.members)[number],
      (typeof accounts.members)[number],
      (typeof accounts.members)[number],
    ];
    let view = await createDrawRoom(host.context.request);
    view = await claimSeat(host, view, { role: 'affirmative', slot: 0 });
    view = await claimSeat(guest, view, { role: 'negative', slot: 0 });
    // Ready needs the device check, which needs scripts: it goes through the API.
    await readyOwnSeat(host, view, { role: 'affirmative', slot: 0 });
    view = await readyOwnSeat(guest, view, { role: 'negative', slot: 0 });

    // The host draws from a native form.
    const hostNoScript = await noScriptPage(
      browser,
      host,
      'Strike host, no JavaScript',
    );
    opened.push(hostNoScript.context);
    await hostNoScript.page.goto(`/rooms/${view.id}`);
    await hostNoScript.page
      .getByRole('button', { name: 'Draw the resolutions', exact: true })
      .click();

    const spectator = await openPage(watcher.context, 'Strike spectator');
    await spectator.goto(`/rooms/${view.id}`);
    await expect(
      spectator.getByText('Hidden until the debaters finish striking'),
    ).toBeVisible();
    expect(await spectator.content()).not.toContain(SENTINEL);

    // The Negative strikes first; a second tab still holds the same turn's form.
    const negative = await noScriptPage(
      browser,
      guest,
      'Strike negative, no JavaScript',
    );
    opened.push(negative.context);
    const stale = await openPage(negative.context, 'Stale strike form');
    for (const page of [negative.page, stale]) {
      await page.goto(`/rooms/${view.id}`);
      await expect(page.getByRole('heading', { name: yourTurn })).toBeVisible();
    }
    // Without scripts the timer is the server read's own count: within the 15 s window.
    // Anchored: the clock ends the timer, and no digit may precede its 0.
    await expect(negative.page.getByRole('timer')).toHaveText(
      /(?<![\d:])0:(0\d|1[0-5])\s*$/,
    );
    await negative.page.getByRole('radio').first().check();
    await negative.page
      .getByRole('button', { name: 'Strike this resolution' })
      .click();
    await expect(negative.page.getByText('You struck this')).toBeVisible();
    await stale.getByRole('radio', { disabled: false }).last().check();
    await stale.getByRole('button', { name: 'Strike this resolution' }).click();
    await expect(
      stale.getByText(
        'Someone struck first, or time ran out. Here is the draw now.',
      ),
    ).toBeVisible();

    // The Affirmative lets its window run out; Refresh shows the reveal.
    const revealed = async () =>
      roomViewSchema.parse(
        await (
          await watcher.context.request.get(`/api/rooms/${view.id}`)
        ).json(),
      );
    await expect(async () => {
      expect((await revealed()).topic).not.toBeNull();
    }).toPass({ timeout: 60_000 });
    const survivor = (await revealed()).topic!;
    expect(lines).toContain(survivor);
    await negative.page.getByRole('link', { name: 'Refresh' }).click();
    await expect(negative.page.getByText(survivor).first()).toBeVisible();
    await expect(negative.page).not.toHaveURL(/notice=/);

    await spectator.reload();
    await expect(spectator.getByText(survivor).first()).toBeVisible();
    const html = await spectator.content();
    for (const line of lines.filter((line) => line !== survivor))
      expect(html).not.toContain(line);

    // Launch needs the host's device check: it goes through the API.
    const ready = roomViewSchema.parse(
      await (await host.context.request.get(`/api/rooms/${view.id}`)).json(),
    );
    const round = await startAdmittedRound(host, ready);
    expect(round.topic).toBe(survivor);
  } finally {
    for (const context of opened) await context.close();
    await accounts.closeContexts();
  }
});

test('a Freestyle bank strike against a bot: automatic strikes, a confirmed strike, a time-out, the reveal, prep and Launch in the browser', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const host = accounts.members[0]!;
    await host.context.grantPermissions(['camera', 'microphone'], { origin });
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
    // A 15 s strike window, so the time-out takes 15 s, and 20 s of prep:
    // prep can't be cut short, only acknowledged once it runs out.
    view = await command(host.context.request, view, {
      type: 'update-config',
      config: {
        ...freestyle.preset.config,
        resolutionDraw: {
          ...freestyle.preset.config.resolutionDraw,
          strikeWindowMs: 15_000,
        },
        preRoundPrep: { enabled: true, durationMs: 20_000 },
      },
    });
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

    const page = await openPage(host.context, 'Freestyle strike host');
    await page.goto(`/rooms/${view.id}`);
    await readyUp(page);

    await page
      .getByRole('button', { name: 'Draw the resolutions', exact: true })
      .click();

    // The bot side strikes on its own; the page rereads at each due instant.
    const myTurn = page.getByRole('heading', { name: yourTurn });
    await expect(myTurn).toBeVisible({ timeout: 20_000 });
    await page.getByRole('radio', { disabled: false }).first().check();
    await page.getByRole('button', { name: 'Strike this resolution' }).click();
    await expect(
      page.getByText(/^Strike ‘.+’\? You can’t undo a strike\.$/),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Strike it' }).click();
    await expect(page.getByText('You struck this')).toBeVisible();

    // The second human turn runs out: Daisy strikes, and the last one left is revealed.
    const read = async () =>
      roomViewSchema.parse(
        await (await host.context.request.get(`/api/rooms/${view.id}`)).json(),
      );
    await expect(async () => {
      expect((await read()).topic).not.toBeNull();
    }).toPass({ timeout: 60_000 });
    const survivor = (await read()).topic!;
    await expect(page.getByText(survivor).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByText(/^How it was chosen/).click();
    await expect(
      page.getByText('Daisy struck this for you · time ran out'),
    ).toBeVisible();
    // Prep started at the reveal and is already counting down.
    await expect(page.getByText(/^\d+:\d{2} left$/)).toBeVisible();

    // When prep runs out the page rereads and offers its acknowledgment.
    await page
      .getByRole('button', { name: 'End prep', exact: true })
      .click({ timeout: 30_000 });
    const roundId = await startRoundInBrowser(page);
    const round = await readBallotRound(host.context.request, roundId);
    expect(round.topic).toBe(survivor);
  } finally {
    await accounts.closeContexts();
  }
});
