import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import type { LobbyCommandAnswer } from '@daisy/protocol/lobby/command';
import type { TournamentSetupCommand } from '@daisy/protocol/lobby/lobby-setup-command';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { setupCommand } from '../src/features/tab/operations/setup';
import { settingCommand } from '../src/features/tab/operations/settings';
import { entryEnrollmentCommand } from '../src/features/tab/operations/entry-enrollment';
import { drawCommand } from '../src/features/tab/operations/draw-command';
import { drawCompetition } from '../src/features/tab/operations/draw-competition';
import { eventResultCommand } from '../src/features/tab/operations/event-result-command';
import { as } from './tab-tournament-organization-wiring.test-support';
import type { Bot, World } from './tab-tournament.test-support';

export async function requireAccepted(
  answer: Promise<LobbyCommandAnswer<string>>,
  label: string,
) {
  const result = await answer;
  if (result.kind !== 'accepted')
    throw new Error(`${label}: ${JSON.stringify(result)}`);
  return result.receipt;
}

/** A genuine computed, published bye and its host-entered result; SQL only reads command guards. */
export async function membershipCompetition(
  world: World,
  input: {
    readonly host: Bot;
    readonly owner:
      | { readonly kind: 'self' }
      | { readonly kind: 'organization'; readonly organizationId: string };
    readonly entrant: Bot;
    readonly school: { readonly id: string; readonly controller: Bot } | null;
    readonly templateId: string;
    readonly name: string;
    readonly certify: boolean;
  },
) {
  const common = {
    store: createTabStore(world.database),
    authorize,
    now: world.clock.now,
    newId: createId,
  };
  const host = as(input.host),
    administration = lobbyAdministrationCommand(common),
    setup = setupCommand(common),
    settings = settingCommand(common);
  const lobby = await requireAccepted(
    administration(host, {
      version: 1,
      commandId: createId(),
      expected: {},
      command: {
        type: 'create-lobby',
        owner: input.owner,
        name: input.name,
        handle: `member-${createId()}`,
        lobby: {
          kind: 'tournament',
          eligibility:
            input.owner.kind === 'self'
              ? { kind: 'own', ageRule: 'adults' }
              : {
                  kind: 'standing',
                  lobbyId: world.made.get('standing-lobby')!,
                },
        },
      },
    }),
    'create tournament',
  );
  const lobbyId = lobby.aggregate.id;
  let lobbyVersion = lobby.resultingVersion;
  const configure = async (command: TournamentSetupCommand) => {
    const receipt = await requireAccepted(
      setup(host, {
        version: 1,
        commandId: createId(),
        expected: { lobby: lobbyVersion },
        command,
      }),
      command.type,
    );
    lobbyVersion = receipt.resultingVersion;
    return receipt;
  };
  await configure({
    type: 'add-event',
    lobbyId,
    name: 'Membership event',
    label: null,
    entry: { kind: 'person' },
    pin: { kind: 'template', templateId: input.templateId },
  });
  const [event] =
    await world.sql`select id from events where lobby_id=${lobbyId}`;
  const eventId = String(event!.id);
  await configure({
    type: 'add-stage',
    lobbyId,
    eventId,
    kind: 'preliminary',
    place: 'online',
    timing: { timing: 'live' },
    division: null,
  });
  const [stage] =
    await world.sql`select id from stages where event_id=${eventId}`;
  await configure({
    type: 'add-tab-round',
    lobbyId,
    stageId: String(stage!.id),
    name: 'One-entry round',
    resolution: null,
  });
  const [round] =
    await world.sql`select id from tab_rounds where event_id=${eventId}`;
  await configure({
    type: 'add-time-slot',
    lobbyId,
    name: 'Competition',
    startsAt: world.clock.advance(180),
  });
  const [slot] =
    await world.sql`select id,version from time_slots where lobby_id=${lobbyId}`;
  await configure({
    type: 'place-tab-round',
    lobbyId,
    tabRoundId: String(round!.id),
    timeSlotId: String(slot!.id),
  });
  await requireAccepted(
    administration(host, {
      version: 1,
      commandId: createId(),
      expected: { lobby: lobbyVersion },
      command: { type: 'set-tournament-status', lobbyId, status: 'open' },
    }),
    'open registration',
  );
  for (const [index, [key, value]] of (
    [
      ['entry.registration', { state: 'open' }],
      ['entry.approval', { value: 'automatic' }],
    ] as const
  ).entries())
    await requireAccepted(
      settings(host, {
        version: 1,
        commandId: createId(),
        expected: { settings: index + 1 },
        command: {
          type: 'set-setting',
          scope: { kind: 'event', id: eventId },
          key,
          value,
          hold: 'default',
        },
      }),
      key,
    );
  await requireAccepted(
    entryEnrollmentCommand(common)(
      as(input.school?.controller ?? input.entrant),
      lobbyId,
      {
        version: 1,
        commandId: createId(),
        expected: { entries: 1 },
        command: {
          type: 'submit-entry',
          eventId,
          name: input.entrant.name,
          memberActorIds: [input.entrant.actorId],
          responsible: input.school
            ? { kind: 'school', schoolOrganizationId: input.school.id }
            : { kind: 'self' },
          division: null,
        },
      },
    ),
    'enter actual competitor',
  );
  const [guard] =
    await world.sql`select entries_version,settings_version from events where id=${eventId}`;
  const draw = drawCommand({ ...common, competition: drawCompetition });
  const draft = await requireAccepted(
    draw(host, lobbyId, {
      version: 1,
      commandId: createId(),
      expected: {
        entries: Number(guard!.entries_version),
        settings: Number(guard!.settings_version),
        results: 1,
      },
      command: {
        type: 'generate-draw',
        tabRoundId: String(round!.id),
        resultCutoff: 0,
        seed: 'ab'.repeat(32),
      },
    }),
    'compute one-entry draw',
  );
  const [publicationSlot] =
    await world.sql`select version from time_slots where id=${String(slot!.id)}`;
  await requireAccepted(
    draw(host, lobbyId, {
      version: 1,
      commandId: createId(),
      expected: {
        draw: 1,
        entries: Number(guard!.entries_version),
        timeSlot: Number(publicationSlot!.version),
      },
      command: {
        type: 'publish-draw',
        drawId: draft.aggregate.id,
        overrides: [],
      },
    }),
    'publish real bye',
  );
  const [fixture] =
    await world.sql`select id,version,kind,status from fixtures where event_id=${eventId}`;
  if (fixture?.kind !== 'bye' || fixture.status !== 'published')
    throw new Error('Expected actual published bye');
  const results = eventResultCommand(common);
  const recorded = await requireAccepted(
    results(host, lobbyId, {
      version: 1,
      commandId: createId(),
      expected: { fixture: Number(fixture.version) },
      command: {
        type: 'record-administrative-result',
        fixtureId: String(fixture.id),
        administrativeReason: 'bye',
        reason: 'One actual accepted entry receives the published bye.',
        awards: { kind: 'bye', rule: 'win', panelSize: 1 },
      },
    }),
    'record genuine bye result',
  );
  const certify = () =>
    requireAccepted(
      results(host, lobbyId, {
        version: 1,
        commandId: createId(),
        expected: { results: 2 },
        command: { type: 'certify-event', eventId },
      }),
      'certify real event',
    );
  if (input.certify) await certify();
  return { lobbyId, eventId, resultId: recorded.aggregate.id, certify };
}
