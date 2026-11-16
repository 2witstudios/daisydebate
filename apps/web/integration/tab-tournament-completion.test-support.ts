import { readHostResults } from '../src/features/tab/reads/host-results';
import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import type { TournamentSetupCommand } from '@daisy/protocol/lobby/lobby-setup-command';
import { setupCommand } from '../src/features/tab/operations/setup';
import { settingCommand } from '../src/features/tab/operations/settings';
import { completionCommand } from '../src/features/tab/operations/completion-command';
import { drawCommand } from '../src/features/tab/operations/draw-command';
import { drawCompetition } from '../src/features/tab/operations/draw-competition';
import { judgeRegistrationCommand } from '../src/features/tab/operations/judge-registration';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
import { resultsStage } from './tab-tournament-results.test-support';
import type { World } from './tab-tournament.test-support';

/** Completion consumes retained real Ballots/results, then publishes and plays the actual final. */
export async function completionStage(world: World) {
  const { sql } = world,
    lobbyId = world.made.get('tournament-lobby')!,
    eventId = world.made.get('event')!;
  const principal = as(world.bots.Director!);
  const common = {
    store: createTabStore(world.database),
    authorize,
    now: world.clock.now,
    newId: createId,
  };
  const setup = setupCommand(common),
    settings = settingCommand(common),
    complete = completionCommand(common),
    draw = drawCommand({ ...common, competition: drawCompetition });
  const acceptSetup = async (command: TournamentSetupCommand) => {
    const [lobby] = await sql`select version from lobbies where id=${lobbyId}`;
    const answer = await setup(principal, {
      version: 1,
      commandId: createId(),
      expected: { lobby: Number(lobby!.version) },
      command,
    });
    if (answer.kind !== 'accepted')
      throw new Error(
        `Completion setup ${command.type}: ${JSON.stringify(answer)}`,
      );
    return answer.receipt;
  };
  const stage = await acceptSetup({
    type: 'add-stage',
    lobbyId,
    eventId,
    kind: 'elimination',
    place: 'online',
    timing: { timing: 'live' },
    division: null,
  });
  const [elimination] =
    await sql`select id from stages where event_id=${eventId} and kind='elimination'`;
  if (!stage || !elimination) throw new Error('Actual final stage missing');
  const [event] =
    await sql`select version,entries_version,settings_version from events where id=${eventId}`;
  const configured = await settings(principal, {
    version: 1,
    commandId: createId(),
    expected: {
      event: Number(event!.version),
      entries: Number(event!.entries_version),
      settings: Number(event!.settings_version),
    },
    command: {
      type: 'set-setting',
      scope: { kind: 'event', id: eventId },
      key: 'break.line',
      value: { default: { kind: 'fixed', size: 2 }, byDivision: {} },
      hold: 'default',
    },
  });
  if (configured.kind !== 'accepted')
    throw new Error(`Break line: ${JSON.stringify(configured)}`);
  const [panelGuard] =
    await sql`select version,entries_version,settings_version from events where id=${eventId}`;
  const panel = await settings(principal, {
    version: 1,
    commandId: createId(),
    expected: {
      event: Number(panelGuard!.version),
      entries: Number(panelGuard!.entries_version),
      settings: Number(panelGuard!.settings_version),
    },
    command: {
      type: 'set-setting',
      scope: { kind: 'event', id: eventId },
      key: 'judging.panel',
      value: {
        preliminary: { size: 1, decision: 'majority' },
        elimination: { size: 1, decision: 'majority' },
      },
      hold: 'default',
    },
  });
  if (panel.kind !== 'accepted')
    throw new Error(
      `Explicit supported one-judge panel setting: ${JSON.stringify(panel)}`,
    );
  const version = async () => {
    const [row] =
      await sql`select 1+(select count(*)::int from results where event_id=${eventId})+(select count(*)::int from certifications where event_id=${eventId}) as version`;
    return Number(row!.version);
  };
  const announcement = {
    version: 1,
    commandId: createId(),
    expected: { results: await version() },
    command: { type: 'announce-break', eventId },
  };
  assert({
    given: 'an entrant requesting the actual event break announcement',
    should: 'hide host completion authority',
    actual: await deniedAsNotFound(() =>
      complete(as(world.bots['Debater 1']!), lobbyId, announcement),
    ),
    expected: true,
  });
  const announced = await complete(principal, lobbyId, announcement);
  if (announced.kind !== 'accepted')
    throw new Error(`Break announcement: ${JSON.stringify(announced)}`);
  assert({
    given: 'an exact announcement replay',
    should: 'retain the durable action rather than append another announcement',
    actual: await complete(principal, lobbyId, announcement),
    expected: {
      ...announced,
      receipt: { ...announced.receipt, replayed: true },
    },
  });
  const [wording] =
    await sql`select resolution_pool_id,pool_resolution_id from tab_rounds where id=${world.made.get('tab-round')!}`;
  await acceptSetup({
    type: 'add-tab-round',
    lobbyId,
    stageId: String(elimination.id),
    name: 'Final',
    resolution: {
      poolId: String(wording!.resolution_pool_id),
      poolResolutionId: String(wording!.pool_resolution_id),
    },
  });
  const [final] =
    await sql`select id from tab_rounds where stage_id=${elimination.id}`;
  await acceptSetup({
    type: 'add-time-slot',
    lobbyId,
    name: 'Final',
    startsAt: world.clock.advance(60),
  });
  const [slot] =
    await sql`select id,version from time_slots where lobby_id=${lobbyId} and name='Final'`;
  await acceptSetup({
    type: 'place-tab-round',
    lobbyId,
    tabRoundId: String(final!.id),
    timeSlotId: String(slot!.id),
  });
  const [guards] =
    await sql`select entries_version,settings_version from events where id=${eventId}`;
  const generated = await draw(principal, lobbyId, {
    version: 1,
    commandId: createId(),
    expected: {
      entries: Number(guards!.entries_version),
      settings: Number(guards!.settings_version),
      results: await version(),
    },
    command: {
      type: 'generate-draw',
      tabRoundId: String(final!.id),
      resultCutoff: 1,
      seed: 'cd'.repeat(32),
    },
  });
  if (generated.kind !== 'accepted')
    throw new Error(`Final draw: ${JSON.stringify(generated)}`);
  const drawId = generated.receipt.aggregate.id;
  const [snapshot] = await sql`select inputs from draws where id=${drawId}`;
  const sources = await sql<
    { result_id: string }[]
  >`select result_id from draw_result_inputs where draw_id=${drawId} order by result_id`;
  assert({
    given: 'the actual computed two-entry break final',
    should: 'freeze its bracket and exact latest preliminary result inputs',
    actual: [
      snapshot!.inputs.stage.kind,
      snapshot!.inputs.stage.bracket.seeds.length,
      sources.map((row) => row.result_id),
    ],
    expected: [
      'elimination',
      2,
      [...world.made.entries()]
        .filter(([key]) => key.startsWith('result:'))
        .map(([, id]) => id)
        .sort(),
    ],
  });
  const register = judgeRegistrationCommand({
    ...common,
    minorsReleased: async () => false,
  });
  const judges =
    await sql`select id,actor_id from tournament_judges where lobby_id=${lobbyId}`;
  for (const judge of judges) {
    const person = Object.values(world.bots).find(
      (person) => person.actorId === judge.actor_id,
    )!;
    const available = await register(as(person), lobbyId, {
      version: 1,
      commandId: createId(),
      expected: {},
      command: {
        type: 'set-judge-availability',
        tournamentJudgeId: String(judge.id),
        availability: [
          { timeSlotId: world.made.get('time-slot')!, available: true },
          { timeSlotId: String(slot!.id), available: true },
        ],
      },
    });
    if (available.kind !== 'accepted')
      throw new Error(`Final availability: ${JSON.stringify(available)}`);
  }
  const [currentSlot] =
    await sql`select version from time_slots where id=${slot!.id}`;
  const assigned = await draw(principal, lobbyId, {
    version: 1,
    commandId: createId(),
    expected: { draw: 1, timeSlot: Number(currentSlot!.version) },
    command: { type: 'assign-judges', drawId },
  });
  if (assigned.kind !== 'accepted')
    throw new Error(`Final panel: ${JSON.stringify(assigned)}`);
  const [publishSlot] =
    await sql`select version from time_slots where id=${slot!.id}`;
  const published = await draw(principal, lobbyId, {
    version: 1,
    commandId: createId(),
    expected: {
      draw: 1,
      entries: Number(guards!.entries_version),
      timeSlot: Number(publishSlot!.version),
    },
    command: { type: 'publish-draw', drawId, overrides: [] },
  });
  if (published.kind !== 'accepted')
    throw new Error(`Final publication: ${JSON.stringify(published)}`);
  const originalRound = world.made.get('tab-round')!;
  world.made.set('tab-round', String(final!.id));
  await resultsStage(world);
  world.made.set('tab-round', originalRound);
  const readResults = readHostResults(common);
  const ready = await readResults(principal, { lobbyId, eventId });
  assert({
    given: 'the genuine completed preliminaries and final before certification',
    should:
      'read the current actual result set and exact guard through the Results area',
    actual: [
      ready?.results.certification.kind,
      ready?.results.resultsVersion,
      ready?.stages
        .flatMap((bracket) =>
          bracket.tabRounds.flatMap((round) =>
            round.fixtures.flatMap((fixture) =>
              fixture.state.kind === 'decided' ? [fixture.state.resultId] : [],
            ),
          ),
        )
        .sort(),
    ],
    expected: [
      'ready',
      await version(),
      [...world.made.entries()]
        .filter(([key]) => key.startsWith('result:'))
        .map(([, id]) => id)
        .sort(),
    ],
  });
  const certificate = {
    version: 1,
    commandId: createId(),
    expected: { results: await version() },
    command: { type: 'certify-event', eventId },
  };
  const certified = await complete(principal, lobbyId, certificate);
  if (certified.kind !== 'accepted')
    throw new Error(`Actual event certification: ${JSON.stringify(certified)}`);
  const certifiedRows = await sql<
    { result_id: string }[]
  >`select result_id from certification_results where certification_id=${certified.receipt.aggregate.kind === 'event' ? (await sql`select id from certifications where command_id=${certificate.commandId}`)[0]!.id : ''} order by result_id`;
  assert({
    given: 'the genuine played final and completed preliminaries',
    should:
      'certify exactly the retained latest result set and advance the monotonic guard once',
    actual: [
      certifiedRows.map((row) => row.result_id),
      certified.receipt.resultingVersion,
      await version(),
    ],
    expected: [
      [...world.made.entries()]
        .filter(([key]) => key.startsWith('result:'))
        .map(([, id]) => id)
        .sort(),
      certificate.expected.results + 1,
      certificate.expected.results + 1,
    ],
  });
  const afterCertificate = await readResults(principal, { lobbyId, eventId });
  const [storedCertificate] =
    await sql`select certified_at from certifications where command_id=${certificate.commandId}`;
  assert({
    given: 'the actual accepted certificate and advanced event guard',
    should:
      'read the stored certification time and refuse cross-event or unauthorized reads',
    actual: [
      afterCertificate?.results.certification,
      afterCertificate?.results.resultsVersion,
      await readResults(as(world.bots['Judge A']!), { lobbyId, eventId }),
      await readResults(principal, { lobbyId, eventId: createId() }),
    ],
    expected: [
      {
        kind: 'certified',
        certifiedAt: new Date(
          storedCertificate!.certified_at as string,
        ).toISOString(),
      },
      await version(),
      null,
      null,
    ],
  });
  assert({
    given: 'an exact certification replay after its guard advances',
    should: 'return the original certificate receipt',
    actual: await complete(principal, lobbyId, certificate),
    expected: {
      ...certified,
      receipt: { ...certified.receipt, replayed: true },
    },
  });
}
