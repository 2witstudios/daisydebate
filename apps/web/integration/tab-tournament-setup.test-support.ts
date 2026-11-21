import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import type { TournamentSetupCommand } from '@daisy/protocol/lobby/lobby-setup-command';
import { tournamentSetupViewSchema } from '@daisy/protocol/lobby/lobby-setup-read';
import { tournamentEventSettingsViewSchema } from '@daisy/protocol/lobby/resolved-settings-read';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { readTournamentEventSettings } from '../src/features/tab/reads/tournament-event-settings';
import { readTournamentSetup } from '../src/features/tab/reads/tournament-setup';
import {
  as,
  deniedAsNotFound,
  StageFailed,
} from './tab-tournament-organization-wiring.test-support';
import { tabCommand, tabRead } from './tab-tournament-transport.test-support';
import type { World } from './tab-tournament.test-support';

/** Setup is driven through commands; SQL below only checks the stored outcome. */
export const setupStage = async (world: World): Promise<void> => {
  const director = world.bots.Director!;
  const coach = world.bots.Coach!;
  const lobbyId = world.made.get('tournament-lobby')!;
  const store = createTabStore(world.database);
  const send = tabCommand(world, 'setup');
  let version = 3;
  const accept = async (command: TournamentSetupCommand) => {
    const answer = await send(as(director), {
      version: 1,
      commandId: createId(),
      expected: { lobby: version },
      command,
    });
    if (answer.kind !== 'accepted')
      throw new StageFailed(`setup ${command.type}: ${JSON.stringify(answer)}`);
    version = answer.receipt.resultingVersion;
    return answer.receipt;
  };
  const create = {
    type: 'add-event',
    lobbyId,
    name: 'Varsity',
    label: 'VAR',
    entry: { kind: 'person' },
    pin: {
      kind: 'format',
      formatId: 'freestyle',
      formatVersion: 1,
      ballotDefinition: null,
    },
  } as const;
  assert({
    given: 'a member outside the tournament host authority',
    should: 'deny event setup',
    actual: await deniedAsNotFound(() =>
      send(as(coach), {
        version: 1,
        commandId: createId(),
        expected: { lobby: version },
        command: create,
      }),
    ),
    expected: true,
  });
  await accept(create);
  const [event] =
    await world.sql`select id, format_id, format_version from events where lobby_id = ${lobbyId} and name = 'Varsity'`;
  if (!event) throw new StageFailed('event is missing');
  const eventId = String(event.id);
  world.made.set('event', eventId);
  assert({
    given: 'the accepted event command',
    should: 'pin the real format revision',
    actual: [event.format_id, event.format_version],
    expected: ['freestyle', 1],
  });
  await accept({
    type: 'add-stage',
    lobbyId,
    eventId,
    kind: 'preliminary',
    place: 'online',
    timing: { timing: 'live' },
    division: null,
  });
  const [stage] =
    await world.sql`select id from stages where event_id = ${eventId}`;
  if (!stage) throw new StageFailed('stage is missing');
  await accept({
    type: 'add-resolution',
    lobbyId,
    pool: { kind: 'new', name: 'Spring resolutions' },
    text: 'Public libraries should receive more funding.',
  });
  const [resolution] =
    await world.sql`select id, pool_id from pool_resolutions where lobby_id = ${lobbyId}`;
  if (!resolution) throw new StageFailed('resolution is missing');
  await accept({
    type: 'add-tab-round',
    lobbyId,
    stageId: String(stage.id),
    name: 'Round 1',
    resolution: {
      poolId: String(resolution.pool_id),
      poolResolutionId: String(resolution.id),
    },
  });
  const [round] =
    await world.sql`select id from tab_rounds where event_id = ${eventId}`;
  if (!round) throw new StageFailed('tab round is missing');
  world.made.set('tab-round', String(round.id));
  await accept({
    type: 'add-time-slot',
    lobbyId,
    name: 'Morning',
    startsAt: world.clock.advance(60),
  });
  const [slot] =
    await world.sql`select id from time_slots where lobby_id = ${lobbyId}`;
  if (!slot) throw new StageFailed('slot is missing');
  world.made.set('time-slot', String(slot.id));
  await accept({
    type: 'place-tab-round',
    lobbyId,
    tabRoundId: String(round.id),
    timeSlotId: String(slot.id),
  });
  const placed =
    await world.sql`select r.number, r.time_slot_id, r.pool_resolution_id, s.timing from tab_rounds r join stages s on s.id = r.stage_id where r.id = ${round.id}`;
  assert({
    given: 'the real schedule after setup',
    should: 'retain its slot and fixed resolution under a live stage',
    actual: placed.map(
      (row: {
        number: number;
        time_slot_id: string;
        pool_resolution_id: string;
        timing: string;
      }) => ({ ...row }),
    ),
    expected: [
      {
        number: 1,
        time_slot_id: String(slot.id),
        pool_resolution_id: String(resolution.id),
        timing: 'live',
      },
    ],
  });
  const stale = await send(as(director), {
    version: 1,
    commandId: createId(),
    expected: { lobby: 3 },
    command: {
      type: 'update-event',
      lobbyId,
      eventId,
      name: 'Changed',
      label: 'VAR',
      ballotDefinition: null,
    },
  });
  assert({
    given: 'an old lobby revision',
    should: 'refuse setup without changing the event',
    actual: stale,
    expected: { kind: 'refused', refusal: 'version-conflict' },
  });
  const settings = tabCommand(world, 'settings');
  const follow = await settings(as(director), {
    version: 1,
    commandId: createId(),
    expected: { event: 1, entries: 1, settings: 1 },
    command: {
      type: 'follow-template',
      eventId,
      templateId: 's3tw1srulgcs6y2xhbog8gps',
    },
  });
  assert({
    given: 'a tournament event and a public template from another organization',
    should: 'authorize its current host and follow the stored template',
    actual: follow.kind,
    expected: 'accepted',
  });
  const [lobbySettings] =
    await world.sql`select settings_version from lobbies where id=${lobbyId}`;
  const recording = await settings(as(director), {
    version: 1,
    commandId: createId(),
    expected: { settings: Number(lobbySettings!.settings_version) },
    command: {
      type: 'set-setting',
      scope: { kind: 'lobby', id: lobbyId },
      key: 'recording.capture',
      value: { value: 'off' },
      hold: 'default',
    },
  });
  assert({
    given: 'the fast tournament configured through its actual settings command',
    should:
      'keep recording off independently of the separate recorded event proof',
    actual: recording.kind,
    expected: 'accepted',
  });
  const view = await tabRead(
    world,
    'tournament-setup',
    tournamentSetupViewSchema,
    readTournamentSetup({
      store,
      authorize,
      now: world.clock.now,
    }),
    () => ({ handle: world.made.get('tournament-handle')! }),
  )(as(director), lobbyId);
  assert({
    given: 'the actual stored setup after the public-template follow',
    should: 'serve that event and its real scheduled round to the host',
    actual: view?.events.map((row) => ({
      eventId: row.eventId,
      formatId: row.format.formatId,
      templateId: row.template?.templateId,
      rounds: row.tabRounds.map((scheduled) => [
        scheduled.tabRoundId,
        scheduled.timeSlotId,
      ]),
    })),
    expected: [
      {
        eventId,
        formatId: 'freestyle',
        templateId: 's3tw1srulgcs6y2xhbog8gps',
        rounds: [[String(round.id), String(slot.id)]],
      },
    ],
  });
  const resolved = await tabRead(
    world,
    'tournament-event-settings',
    tournamentEventSettingsViewSchema,
    readTournamentEventSettings({
      store,
      authorize,
      now: world.clock.now,
    }),
    (input) => ({ ...input }),
  )(as(director), { lobbyId, eventId });
  assert({
    given: 'the event after its settings and template have been persisted',
    should: 'serve the actual event settings through the host read',
    actual: resolved && {
      at: resolved.at,
      registration: resolved.settings.some(
        (row) => row.key === 'entry.registration',
      ),
    },
    expected: { at: { kind: 'event', id: eventId }, registration: true },
  });
  world.made.set('tournament-version', String(version));
};
