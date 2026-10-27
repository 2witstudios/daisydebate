import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { historicalCapture } from './media-capture.test-support';
import { withBoundedRound } from './bounded-transaction.test-support';
setupRitewayBun();
requireTestServices(process.env);

for (const mode of [
  'old-observation',
  'old-chunk',
  'room-deletion',
  'current-silence',
]) {
  test(`capture recovery preserves uncertainty: ${mode}`, async () => {
    await withBoundedRound(async (fixture, transaction, roundId) => {
      const f = await historicalCapture(fixture, transaction, roundId);
      const observe = (epoch: number) =>
        f.store.observeCapturedStream({
          ...f.stream,
          epoch,
          trackId: f.clip.trackId,
          observedFrom: f.start.toISOString(),
          observedUntil: f.end.toISOString(),
        });
      try {
        let epoch = (
          await f.store.claimMediaWorkerLease({ ...f.lease, leaseMs: 15000 })
        ).epoch;
        if (mode === 'room-deletion') {
          await fixture.insert('media_vendor_mutations', {
            id: createId(),
            session_id: f.lease.sessionId,
            epoch: 1,
            kind: 'delete',
            payload: {},
            dispatched_at: new Date(f.start.getTime() + 10),
            settled_at: new Date(f.start.getTime() + 20),
            outcome: 'succeeded',
          });
        }
        if (mode === 'old-chunk')
          await f.store.appendCapturedTranscript(f.clip);
        else if (mode !== 'room-deletion') await observe(epoch);
        if (mode !== 'current-silence') {
          // A process can die after observing audio but before queued STT returns.
          await fixture.sql`update media_worker_leases set expires_at=clock_timestamp()-interval '1 second' where session_id=${f.lease.sessionId}`;
          epoch = (
            await f.store.claimMediaWorkerLease({ ...f.lease, leaseMs: 15000 })
          ).epoch;
          if (mode === 'old-chunk') await observe(epoch);
          if (mode === 'room-deletion') {
            await observe(epoch);
            await f.store.appendCapturedTranscript({
              ...f.clip,
              epoch,
              text: 'New room text after rotation',
            });
          }
        }
        if (mode === 'room-deletion') {
          const rows =
            await fixture.sql`select text,capture_worker_epoch from utterances where segment_id=${f.stream.segmentId}`;
          assert({
            given: 'rotation with no old utterance',
            should: 'persist resumed text without a fabricated old-epoch chunk',
            actual: rows.map((row) => [row.text, row.capture_worker_epoch]),
            expected: [['New room text after rotation', epoch]],
          });
        }
        const seal = await f.store.sealCapturedStream({
          ...f.stream,
          epoch,
          expectedChunkCount: ['old-chunk', 'room-deletion'].includes(mode)
            ? 1
            : 0,
        });
        assert({
          given:
            mode === 'current-silence'
              ? 'genuine whole-grant current-epoch silence evidence'
              : `takeover retaining ${mode} evidence`,
          should:
            'preserve complete silence only with current-epoch provenance and classify recovery uncertainty partial',
          actual: seal.state,
          expected: mode === 'current-silence' ? 'complete' : 'partial',
        });
      } finally {
        await fixture.sql`delete from rounds where id=${roundId}`;
      }
    });
  });
}

test('a takeover seal never records fewer chunks than are stored', async () => {
  await withBoundedRound(async (fixture, transaction, roundId) => {
    const f = await historicalCapture(fixture, transaction, roundId);
    try {
      await f.store.claimMediaWorkerLease({ ...f.lease, leaseMs: 15000 });
      await f.store.appendCapturedTranscript(f.clip);
      await fixture.sql`update media_worker_leases set expires_at=clock_timestamp()-interval '1 second' where session_id=${f.lease.sessionId}`;
      const { epoch } = await f.store.claimMediaWorkerLease({
        ...f.lease,
        leaseMs: 15000,
      });
      await assertRejects({
        given:
          'a new epoch sealing a remembered stream with only its own zero count',
        should: 'refuse a seal below the stored chunk count',
        code: 'CONFLICT',
        actual: () =>
          f.store.sealCapturedStream({
            ...f.stream,
            epoch,
            expectedChunkCount: 0,
          }),
      });
      const [stream] = await fixture.sql`
        select state, chunk_count, sealed_chunk_count from transcript_segments
        where segment_id=${f.stream.segmentId}
          and round_participant_id=${f.stream.roundParticipantId}`;
      assert({
        given: 'the refused under-count seal',
        should: 'leave the stream open for finalization with its stored count',
        actual: { ...stream },
        expected: { state: 'open', chunk_count: 1, sealed_chunk_count: null },
      });
    } finally {
      await fixture.sql`delete from rounds where id=${roundId}`;
    }
  });
});
