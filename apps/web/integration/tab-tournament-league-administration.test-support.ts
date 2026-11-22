import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { lobbyLifecycle } from './tab-tournament-lobby-lifecycle.test-support';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
import { tabCommand } from './tab-tournament-transport.test-support';
import type { World } from './tab-tournament.test-support';

export const leagueAdministrationStage = async (
  world: World,
  options: { readonly tournamentOwner?: 'personal' | 'organization' } = {},
): Promise<void> => {
  const director = world.bots.Director!;
  const coach = world.bots.Coach!;
  const organizationId = world.made.get('league')!;
  const send = tabCommand(world, 'lobbyAdministration');
  const create = {
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'create-lobby',
      owner: { kind: 'organization', organizationId },
      name: 'League lobby',
      handle: `league-${createId()}`,
      lobby: { kind: 'standing' },
    },
  };
  const created = await send(as(director), create);
  assert({
    given: 'a league owner',
    should: 'create its standing lobby and replay the receipt',
    actual: [created.kind, await send(as(director), create)],
    expected: [
      'accepted',
      created.kind === 'accepted'
        ? { ...created, receipt: { ...created.receipt, replayed: true } }
        : created,
    ],
  });
  if (created.kind !== 'accepted') throw new Error('lobby creation refused');
  const lobbyId = created.receipt.aggregate.id;
  world.made.set('standing-lobby', lobbyId);
  const setLadder = {
    version: 1,
    commandId: createId(),
    expected: { lobby: 1 },
    command: {
      type: 'set-ladder',
      organizationId,
      lobbyId,
      ladder: { enabled: true, name: 'League ladder' },
    },
  };
  assert({
    given: 'a member without an organization-management grant',
    should: 'hide the ladder command',
    actual: await deniedAsNotFound(() => send(as(coach), setLadder)),
    expected: true,
  });
  const ladder = await send(as(director), setLadder);
  assert({
    given: 'the league owner and a current lobby version',
    should: 'install the ladder and reject a stale update',
    actual: [
      ladder.kind,
      await send(as(director), { ...setLadder, commandId: createId() }),
    ],
    expected: ['accepted', { kind: 'refused', refusal: 'version-conflict' }],
  });
  const rows =
    await world.sql`select l.name, d.name as ladder from lobbies l join ladders d on d.lobby_id = l.id where l.id = ${lobbyId}`;
  assert({
    given: 'the accepted ladder command',
    should: 'persist only the league lobby and its own ladder',
    actual: rows.map((row: { name: string; ladder: string }) => ({
      name: row.name,
      ladder: row.ladder,
    })),
    expected: [{ name: 'League lobby', ladder: 'League ladder' }],
  });
  const season = await send(as(director), {
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'create-season',
      organizationId,
      lobbyId,
      name: 'Spring',
      startsAt: world.clock.now(),
      endsAt: null,
      counting: 'sanction',
      countsLobbyRooms: true,
      rule: {},
    },
  });
  assert({
    given: 'a league with no active season',
    should: 'create its season',
    actual: season.kind,
    expected: 'accepted',
  });
  if (season.kind !== 'accepted') throw new Error('season creation refused');
  const closeEnvelope = {
    version: 1,
    commandId: createId(),
    expected: { season: 1 },
    command: { type: 'close-season', seasonId: season.receipt.aggregate.id },
  };
  const closed = await send(as(director), closeEnvelope);
  assert({
    given: 'a repeated season-close command',
    should: 'replay the close under the season organization scope',
    actual: await send(as(director), closeEnvelope),
    expected:
      closed.kind === 'accepted'
        ? { ...closed, receipt: { ...closed.receipt, replayed: true } }
        : closed,
  });
  await lobbyLifecycle(world, send, director, coach, options.tournamentOwner);
  const closedAgain = await send(as(director), {
    version: 1,
    commandId: createId(),
    expected: { season: 1 },
    command: {
      type: 'close-season',
      seasonId: season.receipt.aggregate.id,
    },
  });
  assert({
    given: 'a new close command with the old season version',
    should: 'refuse the stale command after a successful close',
    actual: closedAgain,
    expected: { kind: 'refused', refusal: 'version-conflict' },
  });
};
