import { systemClock } from '@daisy/clock';
import {
  lobbyCommandReceiptSchema,
  type CommandExpected,
} from '@daisy/protocol/lobby/command';
import { hostRoundViewSchema } from '@daisy/protocol/lobby/draw-read';
import { hostEventsViewSchema } from '@daisy/protocol/lobby/host-events-read';
import { hostNavigationViewSchema } from '@daisy/protocol/lobby/host-navigation-read';
import type { TournamentSetupCommand } from '@daisy/protocol/lobby/lobby-setup-command';
import { tournamentEventSettingsViewSchema } from '@daisy/protocol/lobby/resolved-settings-read';
import type { ResultCommand } from '@daisy/protocol/lobby/result-command';
import { createId } from '@paralleldrive/cuid2';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { origin, signUpMember } from './accounts';
import { expect } from './fixtures';
import { hydrated } from './hydration';

const run = async (script: string, args: readonly string[]) =>
  (
    await promisify(execFile)(
      'bun',
      [fileURLToPath(new URL(script, import.meta.url)), ...args],
      { timeout: 30_000 },
    )
  ).stdout;

export const setTabFlag = (
  key: 'daisy-tab' | 'host-tiers',
  state: 'enabled' | 'default',
) => run('./release-flag-process.ts', [key, state]);

const command = async <Data extends { readonly type: string }>(
  request: APIRequestContext,
  route: string,
  data: Data,
  expected: CommandExpected = {},
) => {
  const response = await request.post(`/api/tab/${route}`, {
    headers: { origin },
    data: { version: 1, commandId: createId(), expected, command: data },
  });
  if (!response.ok())
    throw new Error(
      `${data.type}: HTTP ${response.status()} ${await response.text()}`,
    );
  const answer = await response.json();
  if (answer.kind !== 'accepted')
    throw new Error(`${data.type}: ${JSON.stringify(answer)}`);
  return lobbyCommandReceiptSchema.parse(answer.receipt);
};

const read = async <T>(
  request: APIRequestContext,
  route: string,
  query: Record<string, string>,
  schema: { parse(value: unknown): T },
) => {
  const response = await request.get(
    `/api/tab/${route}?${new URLSearchParams(query)}`,
  );
  if (!response.ok())
    throw new Error(
      `${route}: HTTP ${response.status()} ${await response.text()}`,
    );
  return schema.parse(await response.json());
};

export async function createTournamentInBrowser(page: Page, name: string) {
  await page.goto('/host');
  await page.getByRole('link', { name: 'New tournament or league' }).click();
  const field = page.getByRole('textbox', { name: 'Name', exact: true });
  await hydrated(field);
  await field.fill(name);
  await page.getByRole('button', { name: 'Create tournament' }).click();
  await expect(page).toHaveURL(/\/host\/tournaments\/[^/]+\/setup$/);
  const handle = new URL(page.url()).pathname.split('/')[3];
  if (!handle) throw new Error('No tournament handle after setup');
  return handle;
}

export async function scheduleTournament(
  request: APIRequestContext,
  handle: string,
) {
  const { id: lobbyId } = await read(
    request,
    'host-navigation',
    { kind: 'lobby', handle },
    hostNavigationViewSchema,
  );
  const events = () =>
    read(request, 'host-events', { lobbyId }, hostEventsViewSchema);
  const initial = await events();
  const event = initial.setup.events[0];
  if (!event) throw new Error('The free tournament has no default event');
  const { eventId } = event;
  let lobby = initial.lobbyVersion;
  const add = async (data: TournamentSetupCommand) => {
    const receipt = await command(request, 'lobby-command', data, { lobby });
    lobby = receipt.resultingVersion;
  };
  const eventName = 'Oracle Freestyle';
  await add({
    type: 'update-event',
    lobbyId,
    eventId,
    name: eventName,
    label: 'ORC',
    ballotDefinition: null,
  });
  await add({
    type: 'add-stage',
    lobbyId,
    eventId,
    kind: 'preliminary',
    place: 'online',
    timing: { timing: 'live' },
    division: null,
  });
  await add({
    type: 'add-time-slot',
    lobbyId,
    name: 'Oracle morning',
    startsAt: new Date(
      new Date(systemClock.now()).getTime() + 3_600_000,
    ).toISOString(),
  });
  const wording = 'Cities should expand public transit.';
  await add({
    type: 'add-resolution',
    lobbyId,
    pool: { kind: 'new', name: 'Oracle motions' },
    text: wording,
  });
  const scheduled = await events();
  const stage = scheduled.setup.events[0]?.stages[0];
  const slot = scheduled.setup.timeSlots[0];
  const resolution = scheduled.resolutionChoices.find(
    (choice) =>
      choice.wording?.kind === 'shown' && choice.wording.text === wording,
  );
  if (!stage || !slot || !resolution)
    throw new Error('Requirements for the scheduled round are missing');
  await add({
    type: 'add-tab-round',
    lobbyId,
    stageId: stage.stageId,
    name: 'Oracle opening round',
    resolution: resolution.resolution,
  });
  const tabRound = (await events()).setup.events[0]?.tabRounds[0];
  if (!tabRound) throw new Error('Scheduled round is missing');
  const { tabRoundId } = tabRound;
  await add({
    type: 'place-tab-round',
    lobbyId,
    tabRoundId,
    timeSlotId: slot.timeSlotId,
  });
  return {
    handle,
    lobbyId,
    eventId,
    eventName,
    tabRoundId,
    timeSlotId: slot.timeSlotId,
  };
}

type Schedule = Awaited<ReturnType<typeof scheduleTournament>>;
const roundView = (
  request: APIRequestContext,
  { lobbyId, eventId, tabRoundId }: Schedule,
) =>
  read(
    request,
    'host-round',
    { lobbyId, eventId, tabRoundId },
    hostRoundViewSchema,
  );

export async function registerTournamentCast(
  host: BrowserContext,
  schedule: Schedule,
) {
  const { lobbyId, eventId, timeSlotId } = schedule;
  for (const [key, value] of [
    ['entry.registration', { state: 'open' }],
    ['entry.approval', { value: 'automatic' }],
  ] as const) {
    const { settingsVersion } = await read(
      host.request,
      'tournament-event-settings',
      { lobbyId, eventId },
      tournamentEventSettingsViewSchema,
    );
    const setting = {
      type: 'set-setting',
      scope: { kind: 'event', id: eventId },
      key,
      value,
      hold: 'default',
    };
    await command(host.request, 'settings-command', setting, {
      settings: settingsVersion,
    });
  }

  const entries = `entries-command?lobbyId=${lobbyId}`;
  const judges = `judges-command?lobbyId=${lobbyId}`;
  const names = ['Oracle Azure', 'Oracle Gold'] as const;
  const browser = host.browser();
  if (!browser) throw new Error('No browser for the tournament cast');
  for (const name of [...names, 'judge']) {
    const context = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
    try {
      const { username } = await signUpMember(context.request);
      const actorId = await run('./tab-oracle-data.ts', ['actor', username]);
      if (name === 'judge') {
        await command(host.request, judges, {
          type: 'invite-judge',
          actorId,
          schoolOrganizationId: null,
          chairQualified: true,
          eventIds: [eventId],
        });
        const tournamentJudgeId = await run('./tab-oracle-data.ts', [
          'judge',
          actorId,
          lobbyId,
        ]);
        await command(context.request, judges, {
          type: 'accept-judge-invitation',
          tournamentJudgeId,
        });
        const availability = {
          type: 'set-judge-availability',
          tournamentJudgeId,
          availability: [{ timeSlotId, available: true }],
        };
        await command(context.request, judges, availability);
        return { entries: names, judge: username };
      }
      const { guards } = await roundView(host.request, schedule);
      const entry = {
        type: 'submit-entry',
        eventId,
        name,
        memberActorIds: [actorId],
        responsible: { kind: 'self' },
        division: null,
      };
      await command(context.request, entries, entry, {
        entries: guards.entries,
      });
    } finally {
      await context.close();
    }
  }
  throw new Error('Tournament cast is missing its judge');
}

export async function readDraftPair(
  request: APIRequestContext,
  schedule: Schedule,
) {
  const view = await roundView(request, schedule);
  if (view.kind !== 'draft') throw new Error('Expected a draft');
  const [pair] = view.draw.recordGroups.flatMap((group) => group.fixtures);
  if (!pair || pair.kind !== 'pairing' || pair.entries.length !== 2)
    throw new Error('Expected the two registered entries to be paired');
  return pair;
}

/** Give the host a completed outcome without a media session. The HTTP oracle submits real judge ballots. */
export async function recordAdministrativeResult(
  request: APIRequestContext,
  schedule: Schedule,
  pair: Awaited<ReturnType<typeof readDraftPair>>,
) {
  const version = Number(
    await run('./tab-oracle-data.ts', [
      'fixture',
      pair.fixtureId,
      schedule.lobbyId,
    ]),
  );
  const result: ResultCommand = {
    type: 'record-administrative-result',
    fixtureId: pair.fixtureId,
    administrativeReason: 'ruling',
    reason: 'The director issued a ruling after the published draw.',
    awards: {
      kind: 'winner',
      entries: pair.entries.map((entry, index) => ({
        entryId: entry.entryId,
        won: index === 0,
        ballotCredits: index === 0 ? 1 : 0,
        rankCredits: [],
        points: { kind: 'none' },
      })),
    },
  };
  await command(request, `result-command?lobbyId=${schedule.lobbyId}`, result, {
    fixture: version,
  });
}

export async function createOracleLeague(
  request: APIRequestContext,
  username: string,
) {
  await run('./tab-oracle-data.ts', ['hosting-grant', username]);
  const name = 'Oracle Valley League';
  const handle = `oracle-valley-${createId().slice(0, 10)}`;
  const create = { type: 'create-organization', kind: 'league', name, handle };
  const { aggregate } = await command(request, 'organization-command', create);
  const template = {
    type: 'create-template',
    organizationId: aggregate.id,
    name: 'Oracle league freestyle',
    format: { id: 'freestyle', version: 1 },
    ballotDefinition: null,
  };
  await command(request, 'settings-command', template);
  const season = {
    type: 'create-season',
    organizationId: aggregate.id,
    name: 'Oracle league season',
    startsAt: new Date(
      new Date(systemClock.now()).getTime() - 86_400_000,
    ).toISOString(),
    endsAt: null,
    counting: 'sanction',
    countsLobbyRooms: false,
    rule: {
      preliminaryWin: { points: 2, cap: null },
      eliminationRound: { points: 3 },
      bestEvents: null,
      topPerSchool: null,
    },
  };
  await command(request, 'lobby-command', season);
  return { handle, name };
}
