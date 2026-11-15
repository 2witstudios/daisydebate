import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { setupCommand } from '../src/features/tab/operations/setup';
import { as } from './tab-tournament-organization-wiring.test-support';
import type { World } from './tab-tournament.test-support';
/** A real league-owned tournament/event; paid hosting is a test fact, never a production issuer. */
export const createOwnedEvent = async (world: World) => {
  const common = {
    store: createTabStore(world.database),
    authorize,
    now: world.clock.now,
    newId: createId,
  };
  const created = await lobbyAdministrationCommand({
    ...common,
    hostingPlan: async () => true,
  })(as(world.bots.Director!), {
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'create-lobby',
      owner: {
        kind: 'organization',
        organizationId: world.made.get('league')!,
      },
      name: 'League-owned setup',
      handle: `setup-${createId()}`,
      lobby: { kind: 'tournament', admitsMinors: false },
    },
  });
  if (created.kind !== 'accepted') throw new Error('League tournament refused');
  const lobbyId = created.receipt.aggregate.id;
  const event = await setupCommand(common)(as(world.bots.Director!), {
    version: 1,
    commandId: createId(),
    expected: { lobby: 1 },
    command: {
      type: 'add-event',
      lobbyId,
      name: 'Original event',
      label: 'ONE',
      entry: { kind: 'person' },
      pin: {
        kind: 'format',
        formatId: 'freestyle',
        formatVersion: 1,
        ballotDefinition: null,
      },
    },
  });
  if (event.kind !== 'accepted') throw new Error('Setup event refused');
  const [row] =
    await world.sql`select id from events where lobby_id=${lobbyId}`;
  if (!row) throw new Error('Created event missing');
  return { lobbyId, eventId: String(row.id) };
};
