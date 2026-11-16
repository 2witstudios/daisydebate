import { SQL } from 'bun';
import { Room, RoomEvent } from '@livekit/rtc-node';
import { once } from 'node:events';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import {
  scratchDatabase,
  committingRuntimeTestDatabase,
} from '@daisy/db/testing';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { withRoomRuntime } from './room-runtime.test-support';
import { committedEventRoom } from './tab-event-room-direction.test-support';
import { registerFixtureJudge } from './tab-fixture-judge.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { mediaDependencies, tokenClaims } from './round-media.test-support';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import { fixtureCommand } from '../src/features/tab/operations/fixture-command';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const join = async (token: string) => {
  const room = new Room();
  try {
    await room.connect('ws://127.0.0.1:7880', token, {
      autoSubscribe: true,
      dynacast: false,
    });
    return room;
  } catch {
    await room.disconnect();
    return null;
  }
};

test('actual fixture retirement disconnects a native hidden judge and fences its unexpired token before fresh admission', async () => {
  const scratch = scratchDatabase(databaseUrl, 'fixturenativeretire');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 1 });
  try {
    await scratch.migrate(() => true);
    const world = await committedEventRoom(owner, 'copy', { noPrep: true });
    const director = world.bots.Director!,
      lobbyId = world.made.get('tournament-lobby')!;
    const store = createTabStore(committingRuntimeTestDatabase(owner));
    const nextPerson = world.bots['Judge C']!;
    const nextJudge = await registerFixtureJudge({
      owner,
      store,
      world,
      person: nextPerson,
    });
    await withRoomRuntime(
      async (f) => {
        const cast = await owner<
          { actor_id: string; user_id: string }[]
        >`select p.actor_id,a.user_id from room_participants p join actors a on a.id=p.actor_id where p.room_id=${world.roomId}`;
        for (const person of cast) {
          const caller = { actorId: person.actor_id, userId: person.user_id };
          await f.consent(
            caller,
            await f.operations.view(caller, world.roomId),
            'ready',
          );
        }
        const ready = await f.operations.view(director, world.roomId);
        const started = await f.operations.command(director, world.roomId, {
          type: 'start-round',
          commandId: createId(),
          expectedVersion: ready.version,
        });
        const roundId = started.receipt.roundRef!.id;
        const [old] =
          await owner`select f.id,f.version,j.id judge_id,j.actor_id,p.id participant_id from fixtures f join fixture_judges fj on fj.fixture_id=f.id join tournament_judges j on j.id=fj.tournament_judge_id join room_participants p on p.room_id=f.room_id and p.actor_id=j.actor_id where f.room_id=${world.roomId}`;
        const deps = mediaDependencies(f),
          media = createRoundMediaOperations(deps),
          names = new Set<string>();
        const connected: Room[] = [];
        try {
          const admitted = await media.session(roundId, String(old!.actor_id));
          const [originalSession] = await owner<
            { room_name: string }[]
          >`select room_name from media_sessions where round_id=${roundId}`;
          const oldRoomName = originalSession!.room_name;
          names.add(oldRoomName);
          const native = await join(admitted.token);
          if (!native)
            throw new Error('Original native hidden judge did not connect');
          connected.push(native);
          const disconnected = once(native, RoomEvent.Disconnected, {
            signal: AbortSignal.timeout(5000),
          }).then(
            () => true,
            () => false,
          );
          const send = fixtureCommand({
            store,
            authorize,
            now: () => new Date().toISOString(),
            newId: createId,
          });
          const changed = await send(as(director), lobbyId, {
            version: 1,
            commandId: createId(),
            expected: { fixture: Number(old!.version) },
            command: {
              type: 'replace-judge',
              fixtureId: String(old!.id),
              outJudgeId: String(old!.judge_id),
              inJudgeId: nextJudge.id,
              overrides: [],
            },
          });
          if (changed.kind !== 'accepted')
            throw new Error('Native judge replacement refused');
          await media.recoverActiveSessions();
          const dropped = await disconnected;
          const stale = await join(admitted.token);
          if (stale) connected.push(stale);
          assert({
            given:
              'a genuinely connected hidden judge retired by an actual fixture command on self-hosted LiveKit',
            should:
              'disconnect it and physically delete the old admission room so its unexpired signed token cannot reconnect',
            actual: [
              admitted.grants.hidden,
              tokenClaims(admitted.token).exp * 1000 > Date.now(),
              dropped,
              await deps.media.exists(oldRoomName),
              stale === null,
            ],
            expected: [true, true, true, false, true],
          });
          await assertRejects({
            given:
              'the retired identity asking for a fresh ordinary media token',
            should: 'refuse current seat authority',
            code: 'AUTHORIZATION',
            actual: () => media.session(roundId, String(old!.actor_id)),
          });
          const fresh = await media.session(roundId, nextPerson.actorId);
          const [freshSession] = await owner<
            { room_name: string }[]
          >`select room_name from media_sessions where round_id=${roundId}`;
          const freshRoomName = freshSession!.room_name;
          names.add(freshRoomName);
          const replacement = await join(fresh.token);
          if (replacement) connected.push(replacement);
          const history =
            await owner`select id,public.daisy_round_participant_is_current(id) current from round_participants where round_id=${roundId} and seat_kind='judge' order by id`;
          assert({
            given:
              'the admitted replacement after actual old-room deletion acknowledgement',
            should:
              'join a new hidden-judge room while immutable old identity remains retired',
            actual: [
              replacement !== null,
              freshRoomName !== oldRoomName,
              fresh.grants.hidden,
              history.length,
              history.filter((person: { current: boolean }) => person.current)
                .length,
              history.find(
                (person: { id: string }) => person.id === old!.participant_id,
              )?.current,
            ],
            expected: [true, true, true, 2, 1, false],
          });
        } finally {
          for (const room of connected) await room.disconnect();
          const sessions = await owner<
            { room_name: string }[]
          >`select room_name from media_sessions where round_id=${roundId}`;
          for (const session of sessions) names.add(session.room_name);
          for (const name of names)
            if (await deps.media.exists(name))
              await deps.media.deleteRoom(name);
        }
      },
      { databaseUrl: scratch.url },
    );
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 90_000);
