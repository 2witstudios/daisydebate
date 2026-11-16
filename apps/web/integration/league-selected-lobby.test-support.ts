import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { settingCommand } from '../src/features/tab/operations/settings';
import { createLobbyRoom } from '../src/features/tab/operations/create-lobby-room';
import { readStandingRoomDraft } from '../src/features/tab/reads/standing-room-draft';
import { readLeagueSeason } from '../src/features/tab/reads/league-season';
import { as } from './tab-tournament-organization-wiring.test-support';
import type { World } from './tab-tournament.test-support';

export async function selectedLobbyCases(world: World) {
  const store = createTabStore(world.database);
  const dependencies = {
    store,
    authorize,
    newId: createId,
    now: world.clock.now,
  };
  const principal = as(world.bots.Director!);
  const organizationId = world.made.get('league')!;
  const templateId = world.made.get('league-template')!;
  const administer = lobbyAdministrationCommand(dependencies);
  const siblings: string[] = [];
  for (const name of ['Sibling A', 'Sibling B']) {
    const answer = await administer(principal, {
      version: 1,
      commandId: createId(),
      expected: {},
      command: {
        type: 'create-lobby',
        owner: { kind: 'organization', organizationId },
        name,
        handle: `selected-${createId()}`,
        lobby: { kind: 'standing' },
      },
    });
    if (answer.kind !== 'accepted') throw new Error(JSON.stringify(answer));
    siblings.push(answer.receipt.aggregate.id);
  }
  const lobbyId = siblings.sort()[1]!;
  const offered = await settingCommand(dependencies)(principal, {
    version: 1,
    commandId: createId(),
    expected: { lobby: 1 },
    command: { type: 'offer-template', lobbyId, templateId },
  });
  if (offered.kind !== 'accepted') throw new Error(JSON.stringify(offered));
  const draft = await readStandingRoomDraft(dependencies)(principal, {
    lobbyId,
    templateId,
  });
  if (!draft?.creation) throw new Error('Missing sibling creation read');
  const commandId = createId();
  const created = await createLobbyRoom(dependencies)(principal, {
    version: 1,
    commandId,
    expected: {},
    command: {
      type: 'create-lobby-room',
      lobbyId,
      templateId,
      config: draft.creation.config,
      room: {
        commandId,
        title: 'Selected sibling Room',
        visibility: draft.creation.visibility.value,
        selection: draft.creation.selection,
        resolution: {
          kind: 'custom',
          text: 'Resolved: this is the selected sibling.',
        },
      },
    },
  });
  if (created.kind !== 'accepted') throw new Error(JSON.stringify(created));
  const [first] =
    await world.sql`select id from lobbies where owner_organization_id=${organizationId} and kind='standing' order by id limit 1`;
  const facts = await store.leagueSeason(
    { viewerUserId: principal.userId, organizationId, lobbyId },
    async (value) => value,
  );
  assert({
    given:
      'two sibling standing lobbies and a Room in an explicitly selected nonfirst sibling',
    should: 'select its actual identity and only its Rooms',
    actual: [
      lobbyId !== first!.id,
      facts?.standingLobby?.id,
      facts?.standingRooms.map((room) => [room.id, room.lobbyId]),
    ],
    expected: [true, lobbyId, [[created.receipt.aggregate.id, lobbyId]]],
  });
  const read = readLeagueSeason(dependencies);
  const selected = await read(principal, {
    organizationId,
    lobbyId,
    templateId,
  });
  assert({
    given: 'the selected sibling passed through the application read',
    should: 'retain its identity and Room title in the projection',
    actual: [
      selected?.standingLobby?.id,
      JSON.stringify(selected?.rooms).includes('Selected sibling Room'),
    ],
    expected: [lobbyId, true],
  });
  const [foreign] =
    await world.sql`select id from lobbies where owner_organization_id <> ${organizationId} and kind='standing' order by id limit 1`;
  if (!foreign) throw new Error('Missing actual foreign standing lobby');
  for (const invalidId of [
    createId(),
    world.made.get('tournament-lobby')!,
    String(foreign.id),
  ]) {
    assert({
      given: 'a missing, nonstanding or foreign requested lobby',
      should: 'return null without falling back to an organization sibling',
      actual: await read(principal, {
        organizationId,
        lobbyId: invalidId,
        templateId,
      }),
      expected: null,
    });
  }
  const host = await store.leagueSeason(
    { viewerUserId: principal.userId, organizationId },
    async (value) => value?.standingLobby?.id,
  );
  assert({
    given: 'an organization-only host read',
    should: 'retain its existing first-standing selection',
    actual: host,
    expected: first!.id,
  });
}
