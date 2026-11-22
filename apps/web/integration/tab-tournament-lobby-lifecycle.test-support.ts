import type { LobbyCommandAnswer } from '@daisy/protocol/lobby/command';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import type { TabPrincipal } from '../src/features/tab/tab-principal';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
import type { Bot, World } from './tab-tournament.test-support';

type Send = (
  principal: TabPrincipal,
  body: unknown,
) => Promise<LobbyCommandAnswer>;
export const lobbyLifecycle = async (
  world: World,
  send: Send,
  director: Bot,
  outsider: Bot,
  ownership: 'personal' | 'organization' = 'personal',
): Promise<void> => {
  const command = {
    type: 'create-lobby',
    owner:
      ownership === 'personal'
        ? ({ kind: 'self' } as const)
        : ({
            kind: 'organization',
            organizationId: world.made.get('league')!,
          } as const),
    name: 'Spring Tournament',
    handle: `spring-${createId()}`,
    lobby: {
      kind: 'tournament',
      eligibility:
        ownership === 'personal'
          ? { kind: 'own', ageRule: 'adults' }
          : { kind: 'standing', lobbyId: world.made.get('standing-lobby')! },
    },
  } as const;
  const created = await send(as(director), {
    version: 1,
    commandId: createId(),
    expected: {},
    command,
  });
  assert({
    given: `an adult creating the selected ${ownership} tournament`,
    should: 'create both its lobby and schedule',
    actual: created.kind,
    expected: 'accepted',
  });
  if (created.kind !== 'accepted')
    throw new Error('tournament creation refused');
  const lobbyId = created.receipt.aggregate.id;
  world.made.set('tournament-lobby', lobbyId);
  world.made.set('tournament-handle', command.handle);
  const [owner] =
    await world.sql`select owner_user_id,owner_organization_id from lobbies where id=${lobbyId}`;
  assert({
    given: 'the actual creation command owner choice',
    should:
      'persist the exact person or organization without a synthetic owner account',
    actual: owner,
    expected:
      ownership === 'personal'
        ? { owner_user_id: director.userId, owner_organization_id: null }
        : {
            owner_user_id: null,
            owner_organization_id: world.made.get('league')!,
          },
  });
  const open = {
    version: 1,
    commandId: createId(),
    expected: { lobby: 1 },
    command: { type: 'set-tournament-status', lobbyId, status: 'open' },
  };
  assert({
    given: 'someone outside current tournament host authority',
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
    },
  });
  assert({
    given: 'the opened tournament',
    should: 'persist its changed name',
    actual: update.kind,
    expected: 'accepted',
  });
  const rows =
    await world.sql`select l.name, l.version, t.status from lobbies l join tournaments t on t.lobby_id = l.id where l.id = ${lobbyId}`;
  assert({
    given: 'the accepted setup operations',
    should: 'reload the exact stored state',
    actual: rows.map(
      (row: { name: string; version: number; status: string }) => ({ ...row }),
    ),
    expected: [{ name: 'Spring Open', version: 3, status: 'open' }],
  });
};
