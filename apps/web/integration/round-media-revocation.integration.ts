import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { Room, RoomEvent } from '@livekit/rtc-node';
import { once } from 'node:events';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import { createId } from '@paralleldrive/cuid2';
import { signedCaptureBroker } from './capture-token.test-support';
import {
  mediaDependencies,
  localMediaConfig,
} from './round-media.test-support';
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

async function requiredJoin(token: string) {
  const room = await join(token);
  if (!room) throw new Error('Expected LiveKit connection');
  return room;
}

test('canonical revocation rotates actual self-hosted admission and capture without restoring eligibility', async () => {
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
      await f.sql`select id,room_name from media_sessions where round_id=${roundId}`;
    const roomName = String(session!.room_name);
    const scope = {
      roundId,
      sessionId: String(session!.id),
      workerId: createId(),
      epoch: 1,
    };
    const captureFixture = {
      ...f,
      roundId,
      media: deps.media,
      mediaOperations: operations,
      mediaConfig: localMediaConfig,
    };
    const { capture, broker, principal } = signedCaptureBroker(
      captureFixture,
      scope,
    );
    await capture.claimMediaWorkerLease({
      roundId,
      sessionId: scope.sessionId,
      workerId: scope.workerId,
      leaseMs: 15000,
    });
    const oldCapture = await broker.captureToken(scope, principal);
    const captureRoom = await requiredJoin(oldCapture.token);
    const connected = await requiredJoin(admitted.token);
    try {
      const disconnected = once(connected, RoomEvent.Disconnected, {
        signal: AbortSignal.timeout(5000),
      }).then(
        () => true,
        () => false,
      );
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
        given: 'the revoked judge after rotation',
        should: 'refuse a new admission',
        code: 'AUTHORIZATION',
        actual: () => operations.session(roundId, judge.actorId),
      });
      await assertRejects({
        given: 'the old capture worker renewing after rotation',
        should: 'refuse without stealing the new epoch',
        code: 'CONFLICT',
        actual: () =>
          capture.claimMediaWorkerLease({
            roundId,
            sessionId: scope.sessionId,
            workerId: scope.workerId,
            leaseMs: 15000,
            expectedEpoch: scope.epoch,
          }),
      });
      await assertRejects({
        given: 'the rotated-out worker asking for another token',
        should: 'deny old-room capture authority',
        code: 'CONFLICT',
        actual: () => broker.captureToken(scope, principal),
      });
      await assertRejects({
        given: 'a late old-epoch transcript append after rotation',
        should: 'reject it at the lease fence before touching any stream',
        code: 'CONFLICT',
        actual: () =>
          capture.appendCapturedTranscript({
            ...scope,
            segmentId: createId(),
            roundParticipantId: createId(),
            trackId: 'old-track',
            startOffsetMs: 0,
            durationMs: 1,
            text: 'Must not persist',
            before: '2026-01-01T00:00:00.000Z',
            after: '2026-01-01T00:00:00.001Z',
          }),
      });
      const reopened = await operations.session(roundId, f.host.actorId);
      const replacement = await join(reopened.token);
      const freshWorker = { ...scope, workerId: createId() };
      const lease = await capture.claimMediaWorkerLease({
        roundId,
        sessionId: scope.sessionId,
        workerId: freshWorker.workerId,
        leaseMs: 15000,
      });
      const fresh = signedCaptureBroker(captureFixture, {
        ...freshWorker,
        epoch: lease.epoch,
      });
      const token = await fresh.broker.captureToken(
        { ...freshWorker, epoch: lease.epoch },
        fresh.principal,
      );
      const restartedCapture = await join(token.token);
      try {
        assert({
          given:
            'remaining eligible debater and replacement capture worker with the judge still revoked',
          should:
            'connect both to the new room while keeping old tokens and epoch fenced',
          actual: [
            replacement !== null,
            restartedCapture !== null,
            token.roomName !== roomName,
            lease.epoch > scope.epoch,
            reopened.identity === debater.identity,
            await deps.media.exists(roomName),
          ],
          expected: [true, true, true, true, true, false],
        });
        const staleCapture = await join(oldCapture.token);
        await staleCapture?.disconnect();
        assert({
          given: 'the old capture token after new-room recovery',
          should: 'never recreate or rejoin the deleted room',
          actual: staleCapture === null,
          expected: true,
        });
      } finally {
        await replacement?.disconnect();
        await restartedCapture?.disconnect();
      }
    } finally {
      await connected.disconnect();
      await captureRoom.disconnect();
      const [current] =
        await f.sql`select room_name from media_sessions where round_id=${roundId}`;
      if (current && (await deps.media.exists(current.room_name)))
        await deps.media.deleteRoom(current.room_name);
    }
  });
}, 60_000);
