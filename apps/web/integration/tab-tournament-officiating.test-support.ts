import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { registerFixtureJudge } from './tab-fixture-judge.test-support';
import {
  as,
  deniedAsNotFound,
  presetStaffRoleId,
} from './tab-tournament-organization-wiring.test-support';
import {
  tabCommand,
  tabLobbyCommand,
} from './tab-tournament-transport.test-support';
import type { World } from './tab-tournament.test-support';

/** A real scoped grant, connected proposal and second-person confirmation replace the unready no-show without a new draw. */
export async function officiatingStage(world: World) {
  const store = createTabStore(world.database),
    lobbyId = world.made.get('tournament-lobby')!,
    fixtureId = world.made.get('first-fixture')!,
    roomId = world.made.get('first-room')!;
  const director = world.bots.Director!,
    replacement = world.bots['Judge C']!;
  const send = tabLobbyCommand(world, 'fixture'),
    settle = tabLobbyCommand(world, 'confirmation'),
    organization = tabCommand(world, 'organization');
  const [before] =
    await world.sql`select f.version,j.id judge_id,j.actor_id from fixtures f join fixture_judges fj on fj.fixture_id=f.id join tournament_judges j on j.id=fj.tournament_judge_id where f.id=${fixtureId}`;
  const noShow = Object.values(world.bots).find(
    (person) => person.actorId === before!.actor_id,
  )!;
  const originalCast = await world.sql<
    { id: string; actor_id: string; seat_kind: string }[]
  >`select id,actor_id,seat_kind from room_participants where room_id=${roomId} order by id`;
  const [drawCount] =
    await world.sql`select count(*)::int n from draws where tab_round_id=${world.made.get('tab-round')!}`;
  const nextJudge = await registerFixtureJudge({
    owner: world.sql,
    store,
    world,
    person: replacement,
    ...(world.http ? { send: tabLobbyCommand(world, 'judges') } : {}),
  });
  const [lobby] =
    await world.sql`select version from lobbies where id=${lobbyId}`;
  const granted = await organization(as(director), {
    version: 1,
    commandId: createId(),
    expected: { lobby: Number(lobby!.version) },
    command: {
      type: 'give-grant',
      scope: { kind: 'lobby', lobbyId },
      userId: noShow.userId,
      roleId: presetStaffRoleId,
      expiresAt: null,
    },
  });
  if (granted.kind !== 'accepted') throw new Error('Officiating grant refused');
  const [grant] =
    await world.sql`select id from grants where lobby_id=${lobbyId} and user_id=${noShow.userId} and revoked_at is null`;
  const proposal = {
    version: 1,
    commandId: createId(),
    expected: { fixture: Number(before!.version) },
    command: {
      type: 'replace-judge',
      fixtureId,
      outJudgeId: String(before!.judge_id),
      inJudgeId: nextJudge.id,
      overrides: [],
    },
  };
  const held = await send(as(noShow), lobbyId, proposal);
  if (held.kind !== 'pending')
    throw new Error('Connected official bypassed required confirmation');
  const confirm = {
    version: 1,
    commandId: createId(),
    expected: {},
    command: { type: 'confirm-command', pendingCommandId: proposal.commandId },
  };
  const selfDenied = await deniedAsNotFound(() =>
    settle(as(noShow), lobbyId, confirm),
  );
  const confirmed = await settle(as(director), lobbyId, confirm);
  if (confirmed.kind !== 'accepted')
    throw new Error('Qualified second-person confirmation refused');
  const [history] =
    await world.sql`select actor_user_id,confirmed_by_user_id,conflict_id from action_history where command_id=${proposal.commandId}`;
  const [observation] =
    await world.sql`select basis,handling from conflicts where id=${history!.conflict_id}`;
  const participants = await world.sql<
    {
      id: string;
      actor_id: string;
      seat_kind: string;
      readiness_command_id: string | null;
    }[]
  >`select id,actor_id,seat_kind,readiness_command_id from room_participants where room_id=${roomId} order by id`;
  assert({
    given:
      'a granted official connected to the actual fixture, with an unready judge replaced by an accepted available spare',
    should:
      'hold the conflict, reject self-confirmation, record both real accounts and change only the current judge with fresh Ready required',
    actual: [
      selfDenied,
      history!.actor_user_id,
      history!.confirmed_by_user_id,
      observation!.basis,
      observation!.handling,
      participants
        .filter((person) => person.seat_kind !== 'judge')
        .map(({ readiness_command_id: _ready, ...person }) => person),
      participants
        .filter((person) => person.seat_kind === 'judge')
        .map((person) => person.actor_id),
      participants.every((person) => person.readiness_command_id === null),
      (
        await world.sql`select count(*)::int n from draws where tab_round_id=${world.made.get('tab-round')!}`
      )[0]!.n,
      (await world.sql`select room_id from fixtures where id=${fixtureId}`)[0]!
        .room_id,
    ],
    expected: [
      true,
      noShow.userId,
      director.userId,
      'seated',
      'second_confirms',
      originalCast.filter((person) => person.seat_kind !== 'judge'),
      [replacement.actorId],
      true,
      drawCount!.n,
      roomId,
    ],
  });
  const [currentLobby] =
    await world.sql`select version from lobbies where id=${lobbyId}`;
  const removed = await organization(as(director), {
    version: 1,
    commandId: createId(),
    expected: { lobby: Number(currentLobby!.version) },
    command: {
      type: 'remove-grant',
      scope: { kind: 'lobby', lobbyId },
      grantId: String(grant!.id),
    },
  });
  if (removed.kind !== 'accepted')
    throw new Error('Officiating grant revocation refused');
  const refusedId = createId();
  assert({
    given: 'the same official after its actual scoped grant is revoked',
    should:
      'refuse a new officiating command without relying on its historical confirmation',
    actual: [
      await deniedAsNotFound(() =>
        send(as(noShow), lobbyId, {
          version: 1,
          commandId: refusedId,
          expected: { fixture: confirmed.receipt.resultingVersion },
          command: { type: 'unassign-judge', fixtureId, judgeId: nextJudge.id },
        }),
      ),
      (
        await world.sql`select count(*)::int n from action_history where command_id=${refusedId}`
      )[0]!.n,
    ],
    expected: [true, 0],
  });
  world.made.set('no-show-judge', String(before!.judge_id));
  world.made.set('replacement-judge', nextJudge.id);
  world.made.set('officiating-command', proposal.commandId);
}
