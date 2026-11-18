import { withRoomRuntime } from './room-runtime.test-support';
import { createRoundRuntimeOperations } from '../src/features/round-runtime/operations';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { assembleRoom } from '@daisy/db/room-assembly';
import { validRules } from '@daisy/db/testing';
import { createTabStore } from '@daisy/db/tab';
import { roomConfigSchema, sideSeat } from '@daisy/protocol';
import { activeRoomMembers } from '@daisy/debate-engine';
import { createId } from '@paralleldrive/cuid2';
import { authorize } from '@daisy/auth/authorization';
import { assert } from 'riteway/bun';
import { settingCommand } from '../src/features/tab/operations/settings';
import { readLeagueLadder } from '../src/features/ratings/read-league-ladder';
import { as } from './tab-tournament-organization-wiring.test-support';
import type { World } from './tab-tournament.test-support';

/** Exercise Room assembly, Ready, Start and forfeit through their actual owners. */
export async function leagueRoomRating(world: World) {
  const lobbyId = world.made.get('standing-lobby')!;
  const [ladder] =
    await world.sql`select id from ladders where lobby_id=${lobbyId}`;
  const [lobby] =
    await world.sql`select settings_version from lobbies where id=${lobbyId}`;
  const store = createTabStore(world.database);
  const read = readLeagueLadder({ store, authorize });
  const principal = as(world.bots.Director!);
  const before = await read(principal, { lobbyId });
  const answer = await settingCommand({
    store,
    authorize,
    now: world.clock.now,
    newId: createId,
  })(principal, {
    version: 1,
    commandId: createId(),
    expected: { settings: Number(lobby!.settings_version) },
    command: {
      type: 'set-setting',
      scope: { kind: 'lobby', id: lobbyId },
      key: 'standings.rating_ladder',
      value: { ladderId: String(ladder!.id) },
      hold: 'default',
    },
  });
  if (answer.kind !== 'accepted')
    throw new Error(`Room ladder setting: ${JSON.stringify(answer)}`);
  const [preset] =
    await world.sql`select config from format_presets where format_id='freestyle' and version=1`;
  const config = {
    ...roomConfigSchema.parse(preset!.config),
    preRoundPrep: { enabled: false as const },
    resolutionDraw: { enabled: false as const },
  };
  const roomId = createId();
  await world.database.transaction((tx) =>
    assembleRoom(tx, {
      room: {
        id: roomId,
        hostActorId: principal.actorId,
        title: 'League ladder Room',
        topic: 'League ladder proof',
        visibility: 'unlisted',
        formatId: 'freestyle',
        formatVersion: 1,
        presetVersion: null,
        basis: null,
        competitionType: 'casual',
        teamOneSide: 'affirmative',
        config,
        executionPlan: {
          preRoundPrep: config.preRoundPrep,
          resolutionDraw: config.resolutionDraw,
        },
        rules: validRules,
      },
      lobby: { id: lobbyId, kind: 'standing' },
      templateId: world.made.get('league-template')!,
      ballotDefinition: null,
      capture: null,
      postRoundCall: false,
      now: world.clock.now(),
      caller: {
        userId: principal.userId,
        actorId: world.bots.Director!.actorId,
      },
      cast: null,
      membersOf: (participants) =>
        activeRoomMembers({
          status: 'assembling',
          roundRef: null,
          participants,
        }),
    }),
  );
  const [room] =
    await world.sql`select league_ladder_id from rooms where id=${roomId}`;
  assert({
    given: 'a casual Room assembled under the league setting',
    should: 'freeze only the actual own standing ladder',
    actual: room!.league_ladder_id,
    expected: ladder!.id,
  });
  const [currentLobby] =
    await world.sql`select version from lobbies where id=${lobbyId}`;
  const disabled = await lobbyAdministrationCommand({
    store,
    authorize,
    now: world.clock.now,
    newId: createId,
  })(principal, {
    version: 1,
    commandId: createId(),
    expected: { lobby: Number(currentLobby!.version) },
    command: {
      type: 'set-ladder',
      organizationId: world.made.get('league')!,
      lobbyId,
      ladder: { enabled: false },
    },
  });
  assert({
    given: 'a ladder frozen by a stored league Room',
    should: 'refuse deletion without a foreign-key exception',
    actual: disabled,
    expected: { kind: 'refused', refusal: 'ladder-in-use' },
  });
  if (!world.runtimeDatabaseUrl)
    throw new Error('League Room proof needs its committed runtime resource');
  let roundId = '';
  await withRoomRuntime(
    async (f) => {
      const host = world.bots.Director!;
      let view = await f.operations.view(host, roomId);
      // Decision 79: a Room on a league ladder rates, so it seats nobody under
      // 18 on the day; the same member at 18 sits as before.
      const minor = world.bots['Debater 2']!;
      const [kept] =
        await world.sql`select birth_month from account_age where user_id=${minor.userId}`;
      await world.sql`update account_age set birth_month=to_char(now() - interval '17 years 11 months','YYYY-MM'), version=version+1 where user_id=${minor.userId}`;
      const underAge = await f
        .command(minor, view, {
          type: 'claim-seat',
          seat: sideSeat('negative'),
        })
        .then(
          () => 'accepted',
          (error: Error) => error.message,
        );
      await world.sql`update account_age set birth_month=${kept!.birth_month}, version=version+1 where user_id=${minor.userId}`;
      assert({
        given:
          'a debater aged 17 years 11 months claiming a league-ladder seat',
        should: 'refuse them on their own age',
        actual: underAge,
        expected: 'ranked-age',
      });
      for (const [side, person] of [
        ['affirmative', world.bots['Debater 1']!],
        ['negative', world.bots['Debater 2']!],
      ] as const) {
        view = (
          await f.command(person, view, {
            type: 'claim-seat',
            seat: sideSeat(side),
          })
        ).view;
      }
      for (const person of [world.bots['Debater 1']!, world.bots['Debater 2']!])
        view = (await f.consent(person, view, 'ready')).view;
      await f.command(host, view, { type: 'start-round' });
      const [frozen] =
        await world.sql`select id,league_ladder_id,ladder_id from rounds where room_id=${roomId}`;
      if (!frozen) throw new Error('League Room Start did not create a Round');
      roundId = String(frozen.id);
      assert({
        given: 'the actual ordinary Room Ready and Start operations',
        should:
          'copy the selected league ladder and leave Daisy ratedness empty',
        actual: [frozen.league_ladder_id, frozen.ladder_id],
        expected: [ladder!.id, null],
      });
      const round = (await f.store.getRound(roundId))!;
      const debater = round.participants.find(
        (person) => person.actorId === world.bots['Debater 1']!.actorId,
      )!;
      await createRoundRuntimeOperations({
        store: f.store,
        nextSegmentId: createId,
      }).command({ kind: 'human', actorId: debater.actorId! }, roundId, {
        version: 1,
        commandId: createId(),
        expectedVersion: round.version,
        command: { type: 'forfeit', participantId: debater.id },
      });
    },
    { databaseUrl: world.runtimeDatabaseUrl },
  );
  const games = (actorId: string, lines: typeof before) => {
    const row = lines?.lines.find((row) => row.actorId === actorId);
    return row ? row.wins + row.losses : 0;
  };
  // A check-in writer still in doubt is a Round Daisy refuses to rate
  // (`check-in-pending`): the league ladder refuses it on the same facts.
  const attemptId = createId();
  await world.sql`insert into round_check_in_attempts(attempt_id,command_id,round_id,payload_digest,actor_id,backend_pid,backend_started_at)
    values (${attemptId},${createId()},${roundId},${'0'.repeat(64)},${world.bots['Debater 1']!.actorId},1,now())`;
  const pending = await read(principal, { lobbyId });
  assert({
    given: 'a forfeited league Round whose check-in writer is still in doubt',
    should: 'count on the league ladder for no competitor, as Daisy rates it',
    actual: [world.bots['Debater 1']!, world.bots['Debater 2']!].map(
      (person) =>
        games(person.actorId, pending) - games(person.actorId, before),
    ),
    expected: [0, 0],
  });
  await world.sql`update round_check_in_attempts set state='aborted',resolved_at=now() where attempt_id=${attemptId}`;
  const after = await read(principal, { lobbyId });
  assert({
    given: 'a finalized own-lobby result and its frozen actor seats',
    should:
      'add exactly one league game per competitor without a Daisy ledger write',
    actual: [
      games(world.bots['Debater 1']!.actorId, after) -
        games(world.bots['Debater 1']!.actorId, before),
      games(world.bots['Debater 2']!.actorId, after) -
        games(world.bots['Debater 2']!.actorId, before),
      (
        await world.sql`select count(*)::int as count from rating_changes where round_id=${roundId}`
      )[0]!.count,
    ],
    expected: [1, 1, 0],
  });
}
