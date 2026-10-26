import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
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

/** Seals one stream after observing the given offsets from its segment start. */
async function sealObserved(
  capture: Awaited<ReturnType<typeof historicalCapture>>,
  observed: readonly (readonly [number, number])[],
) {
  const { store, lease, stream, clip, start } = capture;
  const at = (ms: number) => new Date(start.getTime() + ms).toISOString();
  const [first] = observed[0]!;
  await store.claimMediaWorkerLease({ ...lease, leaseMs: 15000 });
  await store.appendCapturedTranscript({
    ...clip,
    startOffsetMs: first + 100,
    durationMs: 500,
    before: at(first + 99),
    after: at(first + 601),
  });
  for (const [from, until] of observed)
    await store.observeCapturedStream({
      ...stream,
      trackId: clip.trackId,
      observedFrom: at(from),
      observedUntil: at(until),
    });
  return (await store.sealCapturedStream({ ...stream, expectedChunkCount: 1 }))
    .state;
}

test('a human grant is required from the first frame within the join tolerance to the last frame before the yield (DEC-218, DEC-220)', async () => {
  // The runtime lane's AC: grant 44.561-49.751 s, observed 46.495-49.725 s.
  const cases = [
    ['the measured late join and early yield', [[1934, 5164]], 'complete'],
    [
      'a microphone heard only after the join tolerance',
      [[4100, 5164]],
      'partial',
    ],
    [
      'a dropout after the late join',
      [
        [1934, 3000],
        [3100, 5164],
      ],
      'partial',
    ],
  ] as const;
  const actual: string[] = [];
  for (const [, observed] of cases)
    await withBoundedRound(async (fixture, transaction, roundId) => {
      try {
        actual.push(
          await sealObserved(
            await historicalCapture(
              fixture,
              transaction,
              roundId,
              1000,
              60_000,
              {
                durationMs: 5190,
              },
            ),
            observed,
          ),
        );
      } finally {
        await fixture.sql`delete from rounds where id=${roundId}`;
      }
    });
  assert({
    given: cases.map(([given]) => given).join('; '),
    should:
      'seal complete only when capture covers the grant from its first frame to its last within the tolerances',
    actual,
    expected: cases.map(([, , state]) => state),
  });
});

test('a bot stream is required only over its credited publication windows (DEC-218)', async () => {
  // The runtime lane's NC: a 60 s floor, phrases observed 0.912-3.802 s in.
  const cases = [
    ['its phrases captured behind their credit', [[912, 3802]], 'complete'],
    ['a phrase heard after relay tolerance', [[1912, 3802]], 'partial'],
    [
      'a dropout inside its phrases',
      [
        [912, 2000],
        [2100, 3802],
      ],
      'partial',
    ],
  ] as const;
  const actual: string[] = [];
  for (const [, observed] of cases)
    await withBoundedRound(async (fixture, transaction, roundId) => {
      try {
        const capture = await historicalCapture(
          fixture,
          transaction,
          roundId,
          1000,
          60_000,
          { durationMs: 60_000, bot: true },
        );
        const at = (ms: number) => new Date(capture.start.getTime() + ms);
        await fixture.insert('round_bot_publication_windows', {
          id: createId(),
          round_id: roundId,
          segment_id: capture.stream.segmentId,
          round_participant_id: capture.stream.roundParticipantId,
          credited_from: at(880),
          credited_until: at(3790),
        });
        actual.push(await sealObserved(capture, observed));
      } finally {
        await fixture.sql`delete from rounds where id=${roundId}`;
      }
    });
  assert({
    given: cases.map(([given]) => given).join('; '),
    should:
      'seal complete when its credited phrases are captured, never requiring the silent floor',
    actual,
    expected: cases.map(([, , state]) => state),
  });
});
