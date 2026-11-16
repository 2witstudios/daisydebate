import { assembleRoom } from '@daisy/db/room-assembly';
import { validRules } from '@daisy/db/testing';
import { createTabStore } from '@daisy/db/tab';
import { roomConfigSchema, emptyRuntimeCheckpointFor } from '@daisy/protocol';
import { activeRoomMembers } from '@daisy/debate-engine';
import { createId } from '@paralleldrive/cuid2';
import { authorize } from '@daisy/auth/authorization';
import { assert } from 'riteway/bun';
import { settingCommand } from '../src/features/tab/operations/settings';
import { readLeagueLadder } from '../src/features/ratings/read-league-ladder';
import { as } from './tab-tournament-organization-wiring.test-support';
import type { World } from './tab-tournament.test-support';

/** Exercise the real Room assembly selection, then provide immutable terminal fixture provenance. */
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
  const config = roomConfigSchema.parse(preset!.config);
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
  const roundId = createId();
  const commandId = createId();
  const at = world.clock.advance(1);
  await world.sql`insert into rounds(id,room_id,league_ladder_id,resolution,competition_type,format_id,format_version,rules_snapshot,status,started_at,completed_at,winning_side,runtime_state) values(${roundId},${roomId},${ladder!.id},'League proof','casual','freestyle',1,${validRules},'completed',${at},${at},'affirmative',${emptyRuntimeCheckpointFor(validRules)})`;
  for (const [side, actorId] of [
    ['affirmative', world.bots['Debater 1']!.actorId],
    ['negative', world.bots['Debater 2']!.actorId],
  ])
    await world.sql`insert into round_participants(id,round_id,actor_id,seat_kind,side,slot) values(${createId()},${roundId},${actorId!},'side',${side!},0)`;
  await world.sql`insert into round_commands(command_id,round_id,actor_id,type,payload_digest,result,resulting_version,applied_at) values(${commandId},${roundId},${principal.actorId},'forfeit',${'a'.repeat(64)},${{}},1,${at})`;
  await world.sql`insert into round_finalizations(round_id,command_id,resulting_version) values(${roundId},${commandId},1)`;
  const after = await read(principal, { lobbyId });
  const games = (actorId: string, lines: typeof before) => {
    const row = lines?.lines.find((row) => row.actorId === actorId);
    return row ? row.wins + row.losses : 0;
  };
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
