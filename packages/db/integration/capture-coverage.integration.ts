import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withBoundedRound } from './bounded-transaction.test-support';
import { historicalCapture } from './media-capture.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('worker-shaped observations seal a fully captured stream complete and a dropped one partial (DEC-213)', async () => {
  for (const dropped of [false, true])
    await withBoundedRound(async (fixture, transaction, roundId) => {
      const { store, lease, stream, clip, start, end } =
        await historicalCapture(fixture, transaction, roundId);
      const at = (ms: number) => new Date(start.getTime() + ms).toISOString();
      // What the worker observes per transcribed clip: nominal frame spans
      // that touch exactly, the first and last extended to the grant edges by
      // contiguous evidence (ISSUE-466-r3).
      const windows = [
        { from: start.toISOString(), until: at(200) }, // the spoken clip
        { from: at(200), until: at(600) }, // silence: empty transcript
        { from: at(600), until: end.toISOString() }, // silence to the end
      ].filter((_, index) => !(dropped && index === 1));
      try {
        await store.claimMediaWorkerLease({ ...lease, leaseMs: 15000 });
        await store.appendCapturedTranscript(clip);
        for (const window of windows)
          await store.observeCapturedStream({
            ...stream,
            trackId: clip.trackId,
            observedFrom: window.from,
            observedUntil: window.until,
          });
        const sealed = await store.sealCapturedStream({
          ...stream,
          expectedChunkCount: 1,
        });
        assert({
          given: dropped
            ? 'the track dropping mid-speech, leaving its middle window unobserved'
            : 'speech and honest silence observed across the whole grant',
          should: dropped
            ? 'seal the stream partial'
            : 'seal the stream complete',
          actual: sealed.state,
          expected: dropped ? 'partial' : 'complete',
        });
      } finally {
        await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
      }
    });
});
