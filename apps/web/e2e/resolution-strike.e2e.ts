import { createId } from '@paralleldrive/cuid2';
import {
  roomCatalogChoiceSchema,
  roomViewSchema,
  type RoomView,
} from '@daisy/protocol';
import { expect, openPage, test } from './support/fixtures';
import { origin } from './support/accounts';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import {
  claimSeat,
  readyOwnSeat,
  startAdmittedRound,
} from './support/human-ballot-round';

const SENTINEL = 'E2E-STRIKE-LINE';
const lines = ['alpha', 'bravo', 'charlie'].map((w) => `${SENTINEL} ${w}`);

/** A casual custom Room on the foundation schedule with a three-line host draw. */
async function createDrawRoom(
  request: import('@playwright/test').APIRequestContext,
) {
  const catalog = await request.get('/api/rooms/catalog');
  const choice = (await catalog.json()).choices
    .map((c: unknown) => roomCatalogChoiceSchema.parse(c))
    .find((c: { formatId: string }) => c.formatId === 'foundation');
  if (!choice) throw new Error('Foundation format missing');
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
          ...choice.definition,
          configurable: {
            ...choice.definition.configurable,
            resolutionDraw: {
              drawSize: { min: 3, max: 7 },
              strikeWindowMs: { min: 15_000, max: 180_000 },
              firstStrikers: ['negative', 'affirmative'],
              sources: ['bank', 'host'],
            },
          },
        },
        config: {
          ...choice.defaultConfig,
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
    const negative = await noScript.newPage();
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
