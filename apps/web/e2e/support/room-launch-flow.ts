import { launchEvidence } from './room-launch-evidence';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  affirmativeSide,
  aiRoleFits,
  isNamedSeat,
  judgeSeat,
  negativeSide,
  roomCastChoiceSchema,
  sameSeat,
  seatsTwoTeams,
  sideOfTeam,
  sideSeat,
  teamOfPlacement,
  type SeatRef,
  type TwoSideKey,
  roomViewSchema,
  type RoomView,
} from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { expect } from './fixtures';
import { origin } from './accounts';
import { foundationSelection } from '../../integration/foundation-selection.test-support';
import { turnOnDevices } from './turn-on-devices';
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
  page.getByRole('dialog', { name: 'Settings', exact: true });
/**
 * Opens the host's Settings dialog through the Settings card's Edit
 * settings; `rules` also opens its speeches-and-rules disclosure.
 */
export async function openRoomSetup(page: Page, rules = false) {
  await page.getByRole('link', { name: 'Edit settings', exact: true }).click();
  await expect(roomSetup(page)).toBeVisible();
  if (rules)
    await page
      .getByText('Customize speeches and rules', { exact: true })
      .click();
  return page.getByRole('form', { name: 'Round settings' });
}
/** Saves the round settings; an accepted save closes Settings. */
export async function saveRoundSettings(page: Page) {
  await roomSetup(page)
    .getByRole('button', { name: 'Save round settings' })
    .click();
  await expect(roomSetup(page)).toBeHidden();
}
/** Closes Settings through its close link. */
export async function closeRoomSetup(page: Page) {
  await page.getByRole('link', { name: 'Close settings', exact: true }).click();
  await expect(roomSetup(page)).toBeHidden();
}
/** Turns prep before the round off in Settings and saves it. */
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
/**
 * Fixed wording for a casual Room that launches without a strike. Freestyle,
 * the one standard, always strikes its resolution (ADR 0142); host wording
 * makes the Room Custom, based on Freestyle, and skips the draw.
 */
export const setResolution = 'Cities should fund public transit.';
/**
 * The league template a casual journey starts from when it needs prep
 * during the round, which Freestyle does not have: Custom, based on it.
 */
export const ldTemplate = 'NSDA Lincoln-Douglas';

/**
 * Fills and submits the shared create-Room form, from /play/room or a
 * fresh-Room page. `resolution` null keeps Freestyle's strike; a string is
 * the host's own wording (see `setResolution`). `template` names a league
 * template, chosen through Custom (see `ldTemplate`).
 */
export async function submitCreateRoom(
  page: Page,
  title: string,
  formatId = 'freestyle',
  ranked = false,
  resolution: string | null = null,
  template: string | null = null,
) {
  const form = page.getByRole('form', { name: 'Create a room' });
  await expect(form).toBeVisible();
  await form
    .locator(`input[name="format"][value="${template ? 'custom' : formatId}"]`)
    .check();
  // Rendered only inside noscript, so it also says this browser runs no script.
  const apply = form.getByRole('button', { name: 'Apply format', exact: true });
  const scripted = (await apply.count()) === 0;
  if (!scripted) await apply.click();
  if (template) {
    await form
      .getByText('Start from a league template', { exact: true })
      .click();
    const templates = form.locator('[name="template"]');
    const option = templates.locator('option').filter({ hasText: template });
    await templates.selectOption((await option.getAttribute('value'))!);
    if (!scripted)
      await form
        .getByRole('button', { name: 'Apply template', exact: true })
        .click();
  }
  await form.getByLabel('Room name', { exact: true }).fill(title);
  if (resolution !== null) {
    await form.locator('[name="resolutionMethod"]').selectOption('custom');
    if (!scripted)
      await form
        .getByRole('button', { name: 'Apply resolution', exact: true })
        .click();
    await form
      .getByLabel('Custom resolution', { exact: true })
      .fill(resolution);
  }
  if (ranked) {
    await form.getByRole('checkbox', { name: 'Ranked', exact: true }).check();
    // A ranked Room is always public, so the form offers no choice (WATCH-5).
    // Without script the page cannot redraw, so the select stays and the words say so.
    if (scripted) await expect(form.getByLabel('Who can join')).toHaveCount(0);
    await expect(
      form.getByText('Ranked Rounds are always public'),
    ).toBeVisible();
  } else await form.getByLabel('Who can join').selectOption('public');
  return createConfiguredRoom(page);
}
/** Submits the settings already configured by the host, then reads the durable Room. */
export async function createConfiguredRoom(page: Page) {
  await page
    .getByRole('form', { name: 'Create a room' })
    .getByRole('button', { name: 'Create room', exact: true })
    .click();
  await expect(page).toHaveURL(/\/rooms\/[a-z0-9]+$/);
  return reread(page.request, new URL(page.url()).pathname.split('/').at(-1)!);
}

export async function createFromPlay(
  page: Page,
  title: string,
  formatId = 'freestyle',
  resolution: string | null = null,
  template: string | null = null,
) {
  await page.goto('/play');
  await page.getByRole('link', { name: /^Open a room\b/ }).click();
  await expect(page).toHaveURL('/play/room');
  return submitCreateRoom(page, title, formatId, false, resolution, template);
}

/**
 * The unjudged two-speech proof room, posted as a custom format: the picker
 * offers only Daisy's standards and league templates (FMT-1), and a judged
 * standard cannot launch with two debaters alone. Opens its page.
 */
export async function createProofRoom(
  page: Page,
  title: string,
  sides: 'open' | 'fixed' = 'fixed',
) {
  const response = await page.request.post('/api/rooms', {
    headers: { origin },
    data: {
      commandId: createId(),
      title,
      resolution: { kind: 'custom', text: 'Proof cities should fund transit' },
      visibility: 'public',
      selection: foundationSelection,
      // Fixed by default, so the Affirmative 1 seat argues the Affirmative.
      sides,
    },
  });
  expect(response.status()).toBe(201);
  const view = roomViewSchema.parse((await response.json()).view);
  await page.goto(`/rooms/${view.id}`);
  return view;
}

/**
 * Fixes a casual Room's sides as seated (ADR 0145): team 1, the Affirmative
 * seats, argues the Affirmative, so Start round flips no coin. A Room the
 * UI creates leaves its sides open; journeys that play a given side fix
 * them first. Returns the durable Room.
 */
export async function fixSides(request: APIRequestContext, view: RoomView) {
  const response = await request.post(`/api/rooms/${view.id}/commands`, {
    headers: { origin },
    data: {
      type: 'set-sides',
      teamOneSide: 'affirmative',
      commandId: createId(),
      expectedVersion: view.version,
    },
  });
  expect(response.status()).toBe(200);
  const fixed = await reread(request, view.id);
  expect(fixed.teamOneSide).toBe('affirmative');
  return fixed;
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

/** "Negative 1", "Judge 1": the seat a numbered seat label names in this Room's format. */
const seatFromLabel = (view: RoomView, label: string): SeatRef => {
  const at = label.lastIndexOf(' ');
  const name = label.slice(0, at);
  const slot = Number(label.slice(at + 1)) - 1;
  const side = view.rules.sides.find((candidate) => candidate.label === name);
  if (side) return sideSeat(side.key, slot);
  const kind = name.toLowerCase();
  if (kind === 'speaker' || kind === 'judge' || kind === 'moderator')
    return { kind, slot };
  throw new Error(`No seat is labelled ${label}`);
};

/**
 * The name the roster gives a seat placed as `label` ("Affirmative 1" is team
 * 1's first seat). Before Start it is named by its side once the sides are
 * fixed and by its team while they are open (ADR 0145), as roomSeatLabel does.
 */
export function rosterSeatName(view: RoomView, label: string): string {
  const seat = seatFromLabel(view, label);
  if (seat.kind !== 'side' || !seatsTwoTeams(view.definition)) return label;
  const team = teamOfPlacement(seat.side as TwoSideKey);
  if (view.teamOneSide !== null) {
    const side = sideOfTeam(team, view.teamOneSide);
    const name = view.rules.sides.find((s) => s.key === side)!.label;
    return `${name} ${seat.slot + 1}`;
  }
  const seats = view.definition.seats.sides;
  if ((seats[affirmativeSide] ?? 0) === 1 && (seats[negativeSide] ?? 0) === 1)
    return `Team ${team}`;
  const n = seat.slot + 1;
  const ordinal =
    n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
  return `Team ${team} · ${ordinal}`;
}

export async function claim(page: Page, view: RoomView, label: string) {
  await page.goto(`/rooms/${view.id}`);
  const name = rosterSeatName(await reread(page.request, view.id), label);
  await page.getByRole('button', { name: `Take ${name}`, exact: true }).click();
  const seat = seatFromLabel(view, label);
  await expect(async () => {
    view = await reread(page.request, view.id);
    expect(
      view.participants
        .filter(isNamedSeat)
        .some(
          (participant) =>
            participant.kind === 'human' && sameSeat(participant.seat, seat),
        ),
    ).toBe(true);
  }).toPass({ timeout: 10_000 });
  return view;
}

const seats = ['Affirmative 1', 'Negative 1', 'Judge 1'] as const;
const seatOf: Record<(typeof seats)[number], SeatRef> = {
  'Affirmative 1': sideSeat(affirmativeSide),
  'Negative 1': sideSeat(negativeSide),
  'Judge 1': judgeSeat(),
};

/** Real actors from the authenticated catalog: bots in every seat but the member's own. */
export async function prepareRoomAs(
  page: Page,
  title: string,
  own: (typeof seats)[number],
) {
  // Launched without a strike: the host's wording stands in for the draw.
  let view = await createFromPlay(page, title, 'freestyle', setResolution);
  // The member's seat names its side in the Round.
  view = await fixSides(page.request, view);
  await page.reload();
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
  // Each seat takes an AI actor of its own kind: bot debaters for sides, the AI judge for the judge seat (ISSUE-750).
  const ofRole = (seat: (typeof seats)[number]) =>
    eligible.filter((bot: ReturnType<typeof roomCastChoiceSchema.parse>) =>
      aiRoleFits(bot.aiRole, seatOf[seat]),
    );
  for (const [index, seat] of seats.filter((s) => s !== own).entries()) {
    const actor = ofRole(seat)[index % ofRole(seat).length]!;
    // The host seats anyone in an open seat from that seat's own row.
    const select = await openSeatPicker(page, rosterSeatName(view, seat));
    const form = page.locator('form').filter({ has: select });
    // The page has caught up with the last seat before this one is posted.
    await expect(form.locator('[name="expectedVersion"]')).toHaveValue(
      String(view.version),
    );
    await select.selectOption(actor.actorId);
    await form.getByRole('button', { name: 'Seat', exact: true }).click();
    await expect(async () => {
      view = await reread(page.request, view.id);
      expect(
        view.participants
          .filter(isNamedSeat)
          .some(
            (participant) =>
              participant.actorId === actor.actorId &&
              sameSeat(participant.seat, seatOf[seat]),
          ),
      ).toBe(true);
    }).toPass({ timeout: 10_000 });
    await expect(
      page.getByRole('listitem', { name: seat, exact: true }),
    ).toHaveCount(0);
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
      status: 'active',
      startedAt: expect.any(String),
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
/** The host's Seat someone on an open seat's row opens its picker (ADR 0145). */
export async function openSeatPicker(page: Page, seatName: string) {
  const select = page.getByLabel(`Seat someone in ${seatName}`, {
    exact: true,
  });
  await page
    .getByRole('listitem')
    .filter({ has: select })
    .getByRole('button', { name: 'Seat someone', exact: true })
    .click();
  await expect(select).toBeVisible();
  // Opening it moves keyboard focus to the choice.
  await expect(select).toBeFocused();
  return select;
}

/** The member's own device checks, then Ready, through the Room page. */
export async function readyUp(page: Page, devices = true) {
  if (devices) await turnOnDevices(page);
  await page.getByRole('button', { name: 'I’m ready', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Not ready', exact: true }),
  ).toBeVisible();
}
