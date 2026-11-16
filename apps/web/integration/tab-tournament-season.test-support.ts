import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { sanctionCommand } from '../src/features/tab/operations/sanction-command';
import { settingCommand } from '../src/features/tab/operations/settings';
import { readLeagueSeason } from '../src/features/tab/reads/league-season';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
import type { World } from './tab-tournament.test-support';

export async function seasonStage(world: World) {
  const store = createTabStore(world.database),
    principal = as(world.bots.Director!);
  const organizationId = world.made.get('league')!,
    lobbyId = world.made.get('tournament-lobby')!,
    eventId = world.made.get('event')!,
    templateId = world.made.get('league-template')!;
  const administration = lobbyAdministrationCommand({
    store,
    authorize,
    newId: createId,
    now: world.clock.now,
  });
  const season = await administration(principal, {
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'create-season',
      organizationId,
      name: 'League championship season',
      startsAt: new Date(Date.now() - 86400000).toISOString(),
      endsAt: null,
      counting: 'sanction',
      countsLobbyRooms: false,
      rule: {
        preliminaryWin: { points: 2, cap: null },
        eliminationRound: { points: 3 },
        bestEvents: null,
        topPerSchool: null,
      },
    },
  });
  if (season.kind !== 'accepted')
    throw new Error(`Season creation: ${JSON.stringify(season)}`);
  const seasonId = season.receipt.aggregate.id;
  world.made.set('league-season', seasonId);
  const read = readLeagueSeason({ store, authorize });
  const before = await read(principal, {
    organizationId,
    seasonId,
    templateId,
  });
  assert({
    given: 'certified results with no league approval',
    should: 'count no unsanctioned competition',
    actual: before?.view.standings.rows,
    expected: [],
  });
  const send = sanctionCommand({ store, authorize, newId: createId });
  const request = {
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'request-sanction',
      leagueId: organizationId,
      eventId,
      templateId,
      seasonId,
    },
  };
  const mismatch = await send(principal, { organizationId, lobbyId }, request);
  assert({
    given: 'an event whose visibility does not meet the league enforcement',
    should: 'refuse sanction without storing a comparison or approval',
    actual: mismatch,
    expected: { kind: 'refused', refusal: 'template-mismatch' },
  });
  const [guard] =
    await world.sql`select version,settings_version from lobbies where id=${lobbyId}`;
  const configured = await settingCommand({
    store,
    authorize,
    newId: createId,
    now: world.clock.now,
  })(principal, {
    version: 1,
    commandId: createId(),
    expected: { settings: Number(guard!.settings_version) },
    command: {
      type: 'set-setting',
      scope: { kind: 'lobby', id: lobbyId },
      key: 'room.visibility',
      value: { value: 'unlisted' },
      hold: 'default',
    },
  });
  if (configured.kind !== 'accepted')
    throw new Error(`Sanction settings: ${JSON.stringify(configured)}`);
  const requested = await send(
    principal,
    { organizationId, lobbyId },
    { ...request, commandId: createId() },
  );
  if (requested.kind !== 'accepted')
    throw new Error(`Sanction request: ${JSON.stringify(requested)}`);
  const approve = {
    version: 1,
    commandId: createId(),
    expected: { sanction: 1 },
    command: {
      type: 'approve-sanction',
      sanctionId: requested.receipt.aggregate.id,
    },
  };
  assert({
    given: 'a registered judge without league-management authority',
    should: 'hide approval even knowing every identifier',
    actual: await deniedAsNotFound(() =>
      send(as(world.bots['Judge A']!), { organizationId, lobbyId }, approve),
    ),
    expected: true,
  });
  const approved = await send(principal, { organizationId, lobbyId }, approve);
  if (approved.kind !== 'accepted')
    throw new Error(`Sanction approval: ${JSON.stringify(approved)}`);
  const view = await read(principal, { organizationId, seasonId, templateId });
  assert({
    given: 'a sanctioned certified tournament',
    should: 'fold all four genuine competitors and receive certified points',
    actual: [
      view?.view.standings.certifiedCount,
      view?.view.standings.rows.length,
      view?.view.standings.rows.some((row) => row.points > 0),
    ],
    expected: [1, 4, true],
  });
  assert({
    given: 'the same approval command after version advancement',
    should: 'replay one receipt without another sanction',
    actual: await send(principal, { organizationId, lobbyId }, approve),
    expected: { ...approved, receipt: { ...approved.receipt, replayed: true } },
  });
  assert({
    given: 'a nonmember or a foreign season identifier',
    should: 'return no league standings',
    actual: [
      await read(as(world.bots['Judge A']!), {
        organizationId,
        seasonId,
        templateId,
      }),
      await read(principal, {
        organizationId,
        seasonId: createId(),
        templateId,
      }),
    ],
    expected: [null, null],
  });
}
