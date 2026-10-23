import { requireTestServices } from '@daisy/config';
import { finalizeAsWeb } from './round-maintenance.test-support';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundTickProjection } from '../src/features/round-finalization/operations';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
import { CAPTURE_STT_LAG_MS } from '@daisy/protocol';
setupRitewayBun();
requireTestServices(process.env);

test('late actual capture cannot bypass a missing cutoff after the scheduler has been paused', async () =>
  withRoomRuntime(async (f) => {
    const { roundId } = await startRuntimeRound(f, await f.assemble());
    await f.sql`update rounds set started_at=clock_timestamp()-interval '20 minutes' where id=${roundId}`;
    const before = (await f.store.getRound(roundId))!;
    const sessionId = createId(),
      workerId = createId(),
      segmentIds = before.rules.segments.map(() => createId());
    await f.sql`insert into media_sessions(id,round_id,room_name) values(${sessionId},${roundId},${createId()})`;
    await f.sql`insert into media_worker_leases(session_id,worker_id,epoch,expires_at) values(${sessionId},${workerId},1,clock_timestamp()+interval '30 seconds')`;
    const store = f.store.createMediaCaptureOperations({
      sttLagMs: CAPTURE_STT_LAG_MS,
      nextId: createId,
      buildProjection: (context) => {
        let index = 0;
        return roundTickProjection(() => segmentIds[index++]!)(context);
      },
    });
    const stream = {
      roundId,
      sessionId,
      workerId,
      epoch: 1,
      segmentId: segmentIds[0]!,
      roundParticipantId: before.participants.find(
        (p) => p.role === 'affirmative',
      )!.id,
    };
    const start = Date.parse(before.startedAt!);
    const trackId = createId();
    const pending = [
      () =>
        store.appendCapturedTranscript({
          ...stream,
          trackId,
          startOffsetMs: 100,
          durationMs: 100,
          text: 'Late actual capture',
          before: new Date(start + 99).toISOString(),
          after: new Date(start + 201).toISOString(),
        }),
      () =>
        store.observeCapturedStream({
          ...stream,
          trackId,
          observedFrom: new Date(start).toISOString(),
          observedUntil: new Date(start + 1000).toISOString(),
        }),
      () => store.sealCapturedStream({ ...stream, expectedChunkCount: 0 }),
    ];
    const [anchors] =
      await f.sql`select final_segment_ended_at,transcript_admission_cutoff from rounds where id=${roundId}`;
    assert({
      given:
        'a launched Round whose scheduler has produced no segment/end/cutoff',
      should: 'exercise the actual absent-anchor ingress edge',
      actual: { segments: before.segments.length, anchors },
      expected: {
        segments: 0,
        anchors: {
          final_segment_ended_at: null,
          transcript_admission_cutoff: null,
        },
      },
    });
    for (const mutation of pending)
      await assertRejects({
        given:
          'late append, observation or seal while the scheduler was paused beyond actual finalend+120s',
        should:
          'run the same engine inside its transaction and refuse closed admission',
        actual: mutation,
        code: 'CONFLICT',
      });
    const [facts] =
      await f.sql`select (select count(*)::int from utterances where round_id=${roundId}) utterances,(select count(*)::int from transcript_segments where round_id=${roundId}) streams,(select count(*)::int from round_transcripts where round_id=${roundId}) frontiers from rounds where id=${roundId}`;
    assert({
      given:
        'refused capture transactions after discovering actual elapsed play',
      should: 'roll back all projected rows and text/frontier writes',
      actual: { round: await f.store.getRound(roundId), facts },
      expected: {
        round: before,
        facts: { utterances: 0, streams: 0, frontiers: 0 },
      },
    });
    const result = await finalizeAsWeb(f, roundId);
    const [end] =
      await f.sql`select extract(epoch from transcript_admission_cutoff-final_segment_ended_at)*1000 delta,transcript_admission_cutoff<=clock_timestamp() due from rounds where id=${roundId}`;
    assert({
      given: 'independent recovery through the actual finalizer',
      should:
        'persist the actual120s anchor and honestly freeze missing human streams incomplete',
      actual: {
        status: result.status,
        complete:
          result.status === 'frozen' ? result.freeze.completeness : null,
        delta: Number(end.delta),
        due: end.due,
      },
      expected: {
        status: 'frozen',
        complete: 'incomplete',
        delta: 120000,
        due: true,
      },
    });
  }));
