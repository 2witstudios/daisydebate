import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import type { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
import type { Bot, World } from './tab-tournament.test-support';

type Send = ReturnType<typeof lobbyAdministrationCommand>;
export const lobbyLifecycle = async (
  world: World,
  send: Send,
  director: Bot,
  outsider: Bot,
): Promise<void> => {
  const command = {
    type: 'create-lobby',
    owner: { kind: 'self' },
    name: 'Spring Tournament',
    handle: `spring-${createId()}`,
    lobby: { kind: 'tournament', admitsMinors: false },
  } as const;
  const created = await send(as(director), {
    version: 1,
    commandId: createId(),
    expected: {},
    command,
  });
  assert({
    given: 'an adult hosting a tournament personally',
    should: 'create both its lobby and schedule',
    actual: created.kind,
    expected: 'accepted',
  });
  if (created.kind !== 'accepted')
    throw new Error('tournament creation refused');
  const lobbyId = created.receipt.aggregate.id;
  world.made.set('tournament-lobby', lobbyId);
  const open = {
    version: 1,
    commandId: createId(),
    expected: { lobby: 1 },
    command: { type: 'set-tournament-status', lobbyId, status: 'open' },
  };
  assert({
    given: 'someone outside a personally owned tournament',
    should: 'deny its lifecycle controls',
    actual: await deniedAsNotFound(() => send(as(outsider), open)),
    expected: true,
  });
  const opened = await send(as(director), open);
  assert({
    given: 'the owner and current version',
    should: 'open registration',
    actual: opened.kind,
    expected: 'accepted',
  });
  const duplicate = await send(as(director), {
    version: 1,
    commandId: createId(),
    expected: {},
    command,
  });
  assert({
    given: 'the same handle with a different command id',
    should: 'refuse it without creating another lobby',
    actual: duplicate,
    expected: { kind: 'refused', refusal: 'handle-taken' },
  });
  const update = await send(as(director), {
    version: 1,
    commandId: createId(),
    expected: { lobby: 2 },
    command: {
      type: 'update-lobby',
      lobbyId,
      name: 'Spring Open',
      admitsMinors: false,
    },
  });
  assert({
    given: 'the opened tournament',
    should: 'persist its changed name and minors declaration',
    actual: update.kind,
    expected: 'accepted',
  });
  const rows =
    await world.sql`select l.name, l.version, t.status, t.admits_minors from lobbies l join tournaments t on t.lobby_id = l.id where l.id = ${lobbyId}`;
  assert({
    given: 'the accepted setup operations',
    should: 'reload the exact stored state',
    actual: rows.map(
      (row: {
        name: string;
        version: number;
        status: string;
        admits_minors: boolean;
      }) => ({ ...row }),
    ),
    expected: [
      { name: 'Spring Open', version: 3, status: 'open', admits_minors: false },
    ],
  });
};
