import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { Room, RoomEvent } from '@livekit/rtc-node';
import { once } from 'node:events';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import { mediaDependencies } from './round-media.test-support';
import { assembleJudgedRoom } from './round-judging.test-support';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);

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

test('canonical revocation of a hidden human judge closes actual self-hosted admission until fresh eligibility', async () => {
  await withRoomRuntime(async (f) => {
    const judge = await f.member();
    let room = await assembleJudgedRoom(f);
    room = (
      await f.command(judge, room, {
        type: 'claim-seat',
        role: 'judge',
        slot: 0,
      })
    ).view;
    for (const caller of [f.host, f.guest, judge])
      room = (
        await f.consent(
          caller,
          await f.operations.view(caller, room.id),
          'ready',
        )
      ).view;
    const { roundId } = await startRuntimeRound(f, room);
    const deps = mediaDependencies(f);
    const operations = createRoundMediaOperations(deps);
    const [debater, admitted] = [
      await operations.session(roundId, f.host.actorId),
      await operations.session(roundId, judge.actorId),
    ];
    const [session] =
      await f.sql`select room_name from media_sessions where round_id=${roundId}`;
    const roomName = String(session!.room_name);
    const connected = await join(admitted.token);
    try {
      const disconnected = connected
        ? once(connected, RoomEvent.Disconnected, {
            signal: AbortSignal.timeout(5000),
          }).then(
            () => true,
            () => false,
          )
        : Promise.resolve(false);
      await f.sql`update users set email_verified=false where id=${judge.userId}`;
      await operations.recoverActiveSessions();
      const dropped = await disconnected;
      const rejoined = await join(admitted.token);
      await rejoined?.disconnect();
      assert({
        given:
          'a connected hidden judge revoked on self-hosted LiveKit, which keeps old tokens valid',
        should:
          'delete the real room so neither the connection nor the unexpired token keeps access',
        actual: [
          admitted.grants.hidden,
          dropped,
          await deps.media.exists(roomName),
          rejoined === null,
        ],
        expected: [true, true, false, true],
      });
      await assertRejects({
        given: 'a seated debater while the revoked judge fact remains',
        should: 'refuse to recreate the room or mint a token',
        code: 'CONFLICT',
        actual: () => operations.session(roundId, f.host.actorId),
      });
      assert({
        given: 'the refused admission',
        should: 'leave the vendor room absent for the old judge token',
        actual: [
          await deps.media.exists(roomName),
          (await operations.read(roundId, f.host.actorId)).state,
        ],
        expected: [false, 'unavailable'],
      });
      await f.sql`update users set email_verified=true where id=${judge.userId}`;
      const reopened = await operations.session(roundId, f.host.actorId);
      assert({
        given: 'fresh canonical eligibility read under the Round lock',
        should: 'reopen admission with a new token for the same opaque room',
        actual: [
          await deps.media.exists(roomName),
          reopened.identity === debater.identity,
          reopened.token !== debater.token,
        ],
        expected: [true, true, true],
      });
    } finally {
      await connected?.disconnect();
    }
  });
}, 30_000);
