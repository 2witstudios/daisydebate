import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { audienceTranscript } from '../src/round-ballot-reads';
import { readTranscriptSnapshot } from '../src/round-protected-reads';
import { withBoundedRound } from './bounded-transaction.test-support';
import { historicalCapture } from './media-capture.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('a transcript read returns the committed prefix across capture epochs', async () => {
  await withBoundedRound(async (fixture, transaction, roundId) => {
    const f = await historicalCapture(fixture, transaction, roundId);
    try {
      await f.store.claimMediaWorkerLease({ ...f.lease, leaseMs: 15000 });
      const at = (offset: number, ms: number) =>
        new Date(f.start.getTime() + offset + ms).toISOString();
      const clip = (epoch: number, offset: number, text: string) => ({
        ...f.clip,
        epoch,
        startOffsetMs: offset,
        durationMs: 100,
        before: at(offset, -1),
        after: at(offset, 101),
        text,
      });
      await f.store.appendCapturedTranscript(clip(1, 100, 'first'));
      await f.store.appendCapturedTranscript(clip(1, 200, 'second'));
      await f.store.observeCapturedStream({
        ...f.stream,
        trackId: f.clip.trackId,
        observedFrom: at(0, 0),
        observedUntil: at(300, 0),
      });
      await fixture.sql`update media_worker_leases set expires_at=clock_timestamp()-interval '1 second' where session_id=${f.lease.sessionId}`;
      const { epoch } = await f.store.claimMediaWorkerLease({
        ...f.lease,
        leaseMs: 15000,
      });
      await f.store.appendCapturedTranscript(clip(epoch, 700, 'third'));
      const read = await transaction((tx) =>
        readTranscriptSnapshot(tx, roundId),
      );
      assert({
        given: 'two chunks in epoch 1, a takeover and a chunk in epoch 2',
        should: 'read every committed line in order, prefix first',
        actual: [epoch, read.utterances.map((line) => line.text)],
        expected: [2, ['first', 'second', 'third']],
      });
      assert({
        given: 'the same lines',
        should: 'carry where each was captured',
        actual: read.utterances.map((line) => line.startOffsetMs),
        expected: [100, 200, 700],
      });
      const observe = (epochNow: number, from: number, until: number) =>
        f.store.observeCapturedStream({
          ...f.stream,
          epoch: epochNow,
          trackId: f.clip.trackId,
          observedFrom: at(from, 0),
          observedUntil: at(until, 0),
        });
      await observe(epoch, 700, 1000);
      const sealed = await f.store.sealCapturedStream({
        ...f.stream,
        epoch,
        expectedChunkCount: 1,
        framesLost: false,
      });
      const closed = await transaction((tx) =>
        readTranscriptSnapshot(tx, roundId),
      );
      assert({
        given: 'a takeover worker sealing with only its own chunk',
        should:
          'close the stream partial and report the span nobody observed, keeping every line',
        actual: [
          sealed.state,
          closed.streams.map((stream) => [stream.state, stream.gaps]),
          closed.utterances.length,
        ],
        expected: [
          'partial',
          [['partial', [{ fromOffsetMs: 300, untilOffsetMs: 700 }]]],
          3,
        ],
      });
      await fixture.sql`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${roundId},1,${closed.revision},'incomplete')`;
      const completed = await transaction((tx) =>
        audienceTranscript(tx, roundId, true),
      );
      assert({
        given: 'that stream frozen',
        should: 'give the completed read every line and the same gap',
        actual: [
          completed?.utterances.length,
          completed?.gaps.map((gap) => [gap.fromOffsetMs, gap.untilOffsetMs]),
        ],
        expected: [3, [[300, 700]]],
      });
    } finally {
      await fixture.sql`delete from rounds where id=${roundId}`;
    }
  });
});

test('a closed stream with a grant still open reports what nobody observed', async () => {
  await withBoundedRound(async (fixture, transaction, roundId) => {
    const f = await historicalCapture(fixture, transaction, roundId);
    try {
      await fixture.sql`update round_speaking_intervals set ended_at=null,ended_version=null where round_id=${roundId}`;
      await fixture.sql`insert into transcript_segments(round_id,segment_id,round_participant_id,state,sealed_at,sealed_chunk_count) values(${roundId},${f.stream.segmentId},${f.stream.roundParticipantId},'partial',now(),0)`;
      const read = await transaction((tx) =>
        readTranscriptSnapshot(tx, roundId),
      );
      assert({
        given: 'a partial stream whose speaking grant was never closed',
        should: 'report the whole speech as a gap',
        actual: read.streams.map((stream) => stream.gaps),
        expected: [[{ fromOffsetMs: 0, untilOffsetMs: 1000 }]],
      });
    } finally {
      await fixture.sql`delete from rounds where id=${roundId}`;
    }
  });
});
