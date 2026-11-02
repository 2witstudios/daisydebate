import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
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
    } finally {
      await fixture.sql`delete from rounds where id=${roundId}`;
    }
  });
});
