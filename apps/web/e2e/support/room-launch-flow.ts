import { launchEvidence } from './room-launch-evidence';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  isNamedSeat,
  roomCastChoiceSchema,
  roomViewSchema,
  type RoomView,
} from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { expect } from './fixtures';
import { origin } from './accounts';
import { foundationSelection } from '../../integration/foundation-selection.test-support';
/** The host's Start round, then the Round room it opens; returns the Round id. */
export async function startRoundInBrowser(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Start round', exact: true }).click();
  await expect(page).toHaveURL(/\/rounds\/[a-z0-9]+\/room$/);
  return new URL(page.url()).pathname.split('/').at(-2)!;
}
export const reread = async (request: APIRequestContext, id: string) => {
  const response = await request.get(`/api/rooms/${id}`);
  expect(response.status()).toBe(200);
  return roomViewSchema.parse(await response.json());
};
export const deniedCommand = (
  request: APIRequestContext,
  view: RoomView,
  body: object,
) =>
  request.post(`/api/rooms/${view.id}/commands`, {
    headers: { origin },
    data: { ...body, commandId: createId(), expectedVersion: view.version },
  });
const roomSetup = (page: Page) =>
  page.getByRole('dialog', { name: 'Room setup', exact: true });
/** Opens Room setup; `rules` also opens its speeches-and-rules disclosure. */
export async function openRoomSetup(page: Page, rules = false) {
  await page.getByRole('link', { name: 'Room setup', exact: true }).click();
  await expect(roomSetup(page)).toBeVisible();
  if (rules)
    await page
      .getByText('Customize speeches and rules', { exact: true })
      .click();
  return page.getByRole('form', { name: 'Round settings' });
}
/** Saves the round settings; an accepted save closes Room setup. */
export async function saveRoundSettings(page: Page) {
  await roomSetup(page)
    .getByRole('button', { name: 'Save round settings' })
    .click();
  await expect(roomSetup(page)).toBeHidden();
}
/** Closes Room setup through its close link. */
export async function closeRoomSetup(page: Page) {
  await page
    .getByRole('link', { name: 'Close room setup', exact: true })
    .click();
  await expect(roomSetup(page)).toBeHidden();
}
/** Turns prep before the round off in Room setup and saves it. */
export async function turnOffPreRoundPrep(page: Page) {
  const settings = await openRoomSetup(page);
  await settings
    .getByRole('checkbox', { name: /^Prep before the round/ })
    .uncheck();
  await saveRoundSettings(page);
}
/** "1:03.456": a duration as the m:ss field takes it. */
export const clockText = (ms: number) => {
  const rest = ms % 60000;
  const fraction = rest % 1000;
  return `${Math.floor(ms / 60000)}:${String(Math.floor(rest / 1000)).padStart(2, '0')}${
    fraction ? `.${String(fraction).padStart(3, '0').replace(/0+$/, '')}` : ''
  }`;
};
/** Fills and submits the shared create-Room form, from /play/room or a fresh-Room page. */
export async function submitCreateRoom(
  page: Page,
  title: string,
  formatId = 'value',
) {
  const form = page.getByRole('form', { name: 'Create a room' });
  await expect(form).toBeVisible();
  const templates = form.getByLabel('Format', { exact: true });
  const values = await templates
    .locator('option')
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
  const selected = values.find(
    (value) => JSON.parse(value).formatId === formatId,
  );
  if (!selected) throw new Error('Required actual format template is missing');
  await templates.selectOption(selected);
  await form.getByLabel('Room name', { exact: true }).fill(title);
  await form.getByLabel('Resolution').fill('Proof cities should fund transit');
  await form.getByLabel('Who can join').selectOption('public');
  await form.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\/[a-z0-9]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  return reread(page.request, id);
}
export async function createFromPlay(
  page: Page,
  title: string,
  formatId = 'value',
) {
  await page.goto('/play');
  await page.getByRole('link', { name: /^Open a room\b/ }).click();
  await expect(page).toHaveURL('/play/room');
  return submitCreateRoom(page, title, formatId);
}

/**
 * The unjudged two-speech proof room, posted as a custom format: the picker
 * offers only Daisy's standards and league templates (FMT-1), and a judged
 * standard cannot launch with two debaters alone. Opens its page.
 */
export async function createProofRoom(page: Page, title: string) {
  const response = await page.request.post('/api/rooms', {
    headers: { origin },
    data: {
      commandId: createId(),
      title,
      topic: 'Proof cities should fund transit',
      visibility: 'public',
      selection: foundationSelection,
    },
  });
  expect(response.status()).toBe(201);
  const view = roomViewSchema.parse((await response.json()).view);
  await page.goto(`/rooms/${view.id}`);
  return view;
}

export async function closeRoom(
  request: APIRequestContext,
  id: string,
): Promise<void> {
  const view = await reread(request, id);
  const response = await request.post(`/api/rooms/${id}/commands`, {
    headers: { origin },
    data: {
      type: 'close',
      commandId: createId(),
      expectedVersion: view.version,
    },
  });
  expect(response.status()).toBe(200);
}

export async function claim(page: Page, view: RoomView, seat: string) {
  await page.goto(`/rooms/${view.id}`);
  await page.getByRole('button', { name: `Take ${seat}`, exact: true }).click();
  const [role, number] = seat.toLowerCase().split(' ');
  await expect(async () => {
    view = await reread(page.request, view.id);
    expect(
      view.participants
        .filter(isNamedSeat)
        .some(
          (participant) =>
            participant.kind === 'human' &&
            participant.role === role &&
            participant.slot === Number(number) - 1,
        ),
    ).toBe(true);
  }).toPass({ timeout: 10_000 });
  return view;
}

const seats = ['Affirmative 1', 'Negative 1', 'Judge 1'] as const;
const seatRole = {
  'Affirmative 1': 'affirmative',
  'Negative 1': 'negative',
  'Judge 1': 'judge',
} as const;

/** Real actors from the authenticated catalog: bots in every seat but the member's own. */
export async function prepareRoomAs(
  page: Page,
  title: string,
  own: (typeof seats)[number],
) {
  let view = await createFromPlay(page, title, 'value');
  await turnOffPreRoundPrep(page);
  await expect(async () => {
    view = await reread(page.request, view.id);
    expect(view.config.preRoundPrep).toEqual({ enabled: false });
  }).toPass({ timeout: 10_000 });
  const settings = await openRoomSetup(page);
  await expect(settings.locator('[name="expectedVersion"]')).toHaveValue(
    String(view.version),
  );
  await closeRoomSetup(page);
  const response = await page.request.get('/api/rooms/catalog');
  expect(response.status()).toBe(200);
  const body = await response.json();
  const bots = body.bots.map((bot: unknown) => roomCastChoiceSchema.parse(bot));
  const eligible = bots.filter(
    (bot: ReturnType<typeof roomCastChoiceSchema.parse>) => bot.eligible,
  );
  expect(eligible.length).toBeGreaterThanOrEqual(2);
  await page.getByText('Manage seats', { exact: true }).click();
  for (const [index, seat] of seats.filter((s) => s !== own).entries()) {
    const select = page.getByLabel(`Assign ${seat}`, { exact: true });
    await select.selectOption(eligible[index]!.actorId);
    await select
      .locator('..')
      .getByRole('button', { name: 'Assign', exact: true })
      .click();
    await expect(async () => {
      view = await reread(page.request, view.id);
      expect(
        view.participants
          .filter(isNamedSeat)
          .some(
            (participant) =>
              participant.actorId === eligible[index]!.actorId &&
              participant.role === seatRole[seat] &&
              participant.slot === 0,
          ),
      ).toBe(true);
    }).toPass({ timeout: 10_000 });
    await expect(
      select.locator('..').locator('[name="expectedVersion"]'),
    ).toHaveValue(String(view.version));
  }
  return claim(page, view, own);
}

export const prepareJudgeRoom = (page: Page, title: string) =>
  prepareRoomAs(page, title, 'Judge 1');

/** Both Launch paths assert the same complete frozen durable projection. */
export async function assertFrozenLaunch(view: RoomView) {
  const proof = await launchEvidence(view.id);
  expect(proof.frozen).toEqual([
    {
      status: 'scheduled',
      startedAt: null,
      topic: view.topic,
      config: view.config,
      rules: view.rules,
      cast: view.participants
        .filter(isNamedSeat)
        .map((participant) => participant.actorId)
        .sort(),
    },
  ]);
  expect(proof.launchDoorbells).toBe(1);
  return proof;
}
/** The member's own device checks, then Ready, through the Room page. */
export async function readyUp(
  page: Page,
  devices: readonly string[] = ['camera', 'microphone'],
) {
  for (const device of devices)
    await page
      .getByRole('button', { name: `Check ${device}`, exact: true })
      .click();
  await page.getByRole('button', { name: 'I’m ready', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Not ready', exact: true }),
  ).toBeVisible();
}
