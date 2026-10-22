import { requireTestServices } from '@daisy/config';
import { finishedOrBlockedBehind } from '@daisy/db/testing';
import { isAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundTickProjection } from '../src/features/round-finalization/operations';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('actual append seal and finalizer contention freezes one truthful committed frontier', async () =>
  withRoomRuntime(async (f) => {
    const { roundId } = await startRuntimeRound(f, await f.assemble());
    const initial = (await f.store.getRound(roundId))!;
    const elapsed = initial.rules.segments.reduce(
      (sum, s) => sum + s.durationMs + initial.rules.countdownMs,
      1000,
    );
    // Storage component: the real engine creates every historical row before capture begins.
    await f.sql`update rounds set started_at=clock_timestamp()-${elapsed}*interval '1 millisecond' where id=${roundId}`;
    const buildProjection = roundTickProjection(createId);
    await f.store.executeRoundTick({ roundId, buildProjection });
    const grants =
      await f.sql`select segment_id,round_participant_id,started_at,ended_at from round_speaking_intervals where round_id=${roundId} order by started_at,segment_id,round_participant_id`;
    const sessionId = createId(),
      workerId = createId();
    await f.sql`insert into media_sessions(id,round_id,room_name) values(${sessionId},${roundId},${createId()})`;
    const capture = f.store.createMediaCaptureOperations({
      nextId: createId,
      buildProjection,
    });
    const identity = { roundId, sessionId, workerId };
    const { epoch } = await capture.claimMediaWorkerLease({
      ...identity,
      leaseMs: 30000,
    });
    const streams = [];
    for (const [index, grant] of grants.entries()) {
      const stream = {
          ...identity,
          epoch,
          segmentId: grant.segment_id as string,
          roundParticipantId: grant.round_participant_id as string,
        },
        trackId = createId();
      const start = new Date(grant.started_at).getTime();
      await capture.appendCapturedTranscript({
        ...stream,
        trackId,
        startOffsetMs: 100,
        durationMs: 100,
        text: `Captured speech ${index}`,
        before: new Date(start + 99).toISOString(),
        after: new Date(start + 201).toISOString(),
      });
      await capture.observeCapturedStream({
        ...stream,
        trackId,
        observedFrom: new Date(grant.started_at).toISOString(),
        observedUntil: new Date(grant.ended_at).toISOString(),
      });
      streams.push({ stream, trackId, start });
    }
    if (streams.length !== 2)
      throw new Error('Fixture requires two actual historical speeches');
    await capture.sealCapturedStream({
      ...streams[0]!.stream,
      expectedChunkCount: 1,
    });
    const last = streams[1]!,
      holder = await f.sql.reserve();
    let races: Promise<unknown>[] = [];
    try {
      await holder`begin`;
      const [backend] = await holder`select pg_backend_pid() as pid`;
      await holder`select id from rounds where id=${roundId} for no key update`;
      const append = capture.appendCapturedTranscript({
        ...last.stream,
        trackId: last.trackId,
        startOffsetMs: 300,
        durationMs: 100,
        text: 'Concurrent final clip',
        before: new Date(last.start + 299).toISOString(),
        after: new Date(last.start + 401).toISOString(),
      });
      const seal = capture.sealCapturedStream({
        ...last.stream,
        expectedChunkCount: 1,
      });
      const finalize = f.store.finalizeRoundTranscript({
        roundId,
        buildProjection,
      });
      races = [append, seal, finalize];
      const settled = Promise.allSettled([append, seal, finalize]);
      const blocked = await finishedOrBlockedBehind(
        finalize,
        f.sql,
        backend.pid,
        { now: performance.now, deadlineMs: 700 },
      );
      await holder`commit`;
      const [appended, sealed, finalized] = await settled;
      if (sealed.status !== 'fulfilled') throw sealed.reason;
      if (finalized.status !== 'fulfilled') throw finalized.reason;
      if (
        appended.status === 'rejected' &&
        (!isAppError(appended.reason) || appended.reason.code !== 'CONFLICT')
      )
        throw appended.reason;
      const accepted = appended.status === 'fulfilled';
      const frozen = await f.store.finalizeRoundTranscript({
        roundId,
        buildProjection,
      });
      const read = await f.store.readFrozenRoundTranscript(roundId);
      const [revision] =
        await f.sql`select revision from round_transcripts where round_id=${roundId}`;
      const ordered =
        await f.sql`select s.sequence as "segmentSequence",u.sequence,u.text from utterances u join round_segments s on s.id=u.segment_id and s.round_id=u.round_id where u.round_id=${roundId} order by s.sequence,u.sequence,u.id`;
      const before = JSON.stringify(read);
      const late = await Promise.allSettled([
        capture.appendCapturedTranscript({
          ...last.stream,
          trackId: last.trackId,
          startOffsetMs: 500,
          durationMs: 100,
          text: 'Too late',
          before: new Date(last.start + 499).toISOString(),
          after: new Date(last.start + 601).toISOString(),
        }),
      ]);
      assert({
        given:
          'actual bounded append/seal/freeze transactions queued behind the same canonical Round lock',
        should:
          'serialize accepted text into one sorted immutable revision and signal any count uncertainty honestly',
        actual: {
          blocked,
          status: frozen.status,
          completeness: read?.completeness,
          frontier: read?.frontier,
          revision: revision.revision,
          lines: read?.utterances.length,
          ordered: read?.utterances.map(
            ({ segmentSequence, sequence, text }) => ({
              segmentSequence,
              sequence,
              text,
            }),
          ),
          lateRefused:
            late[0]?.status === 'rejected' &&
            isAppError(late[0].reason) &&
            late[0].reason.code === 'CONFLICT',
          unchanged:
            JSON.stringify(await f.store.readFrozenRoundTranscript(roundId)) ===
            before,
        },
        expected: {
          blocked: 'blocked',
          status: 'frozen',
          completeness: accepted ? 'incomplete' : 'complete',
          frontier: accepted ? 7 : 6,
          revision: accepted ? 7 : 6,
          lines: accepted ? 3 : 2,
          ordered: [...ordered],
          lateRefused: true,
          unchanged: true,
        },
      });
    } finally {
      await holder`rollback`;
      holder.release();
      await Promise.allSettled(races);
    }
  }));
