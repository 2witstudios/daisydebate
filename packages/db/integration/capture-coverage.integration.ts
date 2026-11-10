import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { frozenCaptureColumns } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { captureRule, freezeJudgingPlan } from '@daisy/debate-engine';
import { readCaptureShortfall } from '../src/capture-shortfall';
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
          framesLost: false,
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
  framesLost = false,
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
  return (
    await store.sealCapturedStream({
      ...stream,
      expectedChunkCount: 1,
      framesLost,
    })
  ).state;
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

test('capture never writes, observes or seals a bot seat: its words are authored (ADR 0122)', async () => {
  const refusals: (string | undefined)[] = [];
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
      const { store, lease, stream, clip, start } = capture;
      const at = (ms: number) => new Date(start.getTime() + ms).toISOString();
      await store.claimMediaWorkerLease({ ...lease, leaseMs: 15000 });
      const reason = (work: () => Promise<unknown>) =>
        work().then(
          () => undefined,
          (error: { reason?: string }) => error.reason,
        );
      refusals.push(
        await reason(() =>
          store.appendCapturedTranscript({
            ...clip,
            startOffsetMs: 1000,
            durationMs: 500,
            before: at(999),
            after: at(1501),
          }),
        ),
        await reason(() =>
          store.observeCapturedStream({
            ...stream,
            trackId: clip.trackId,
            observedFrom: at(900),
            observedUntil: at(3000),
          }),
        ),
        await reason(() =>
          store.sealCapturedStream({
            ...stream,
            expectedChunkCount: 0,
            framesLost: false,
          }),
        ),
      );
      // Once the bot has spoken, its stream exists, sealed by its authored speech.
      await fixture.sql`insert into transcript_segments(round_id,segment_id,round_participant_id,state,chunk_count,sealed_chunk_count,sealed_at) values(${roundId},${stream.segmentId},${stream.roundParticipantId},'complete',0,0,clock_timestamp())`;
      refusals.push(
        await reason(() =>
          store.appendCapturedTranscript({
            ...clip,
            startOffsetMs: 2000,
            durationMs: 500,
            before: at(1999),
            after: at(2501),
          }),
        ),
      );
      const [{ lines }] =
        await fixture.sql`select count(*)::int lines from utterances where round_id=${roundId}`;
      refusals.push(String(lines));
    } finally {
      await fixture.sql`delete from rounds where id=${roundId}`;
    }
  });
  assert({
    given:
      'a bot seat speaking under a live capture lease, before and after its authored speech made its stream',
    should:
      'refuse its captured clip, observation and seal as bot-authored, writing no line',
    actual: refusals,
    expected: [
      'bot-authored',
      'bot-authored',
      'bot-authored',
      'bot-authored',
      '0',
    ],
  });
});

const shortfallOf = async (
  observed: readonly (readonly [number, number])[],
  framesLost: boolean,
) => {
  let shortfall: Awaited<ReturnType<typeof readCaptureShortfall>> | null = null;
  await withBoundedRound(async (fixture, transaction, roundId) => {
    const capture = await historicalCapture(
      fixture,
      transaction,
      roundId,
      1000,
      60_000,
      { durationMs: 5190 },
    );
    await sealObserved(capture, observed, framesLost);
    shortfall = await transaction((tx) =>
      readCaptureShortfall(tx as never, roundId, captureRule),
    );
  });
  return shortfall!;
};

test('a freeze can say how much speech the platform lost', async () => {
  const measured = await shortfallOf(
    [
      [1934, 3000],
      [3100, 5164],
    ],
    true,
  );
  const { captureGapMs, unheardMs, expectedSpeechMs } = frozenCaptureColumns(
    measured.capture,
  );
  const { captureGaps } = measured;
  assert({
    given: 'a sealed stream that lost frames, with a 100 ms dropout',
    should: 'measure that loss, and state where it was in the speech',
    actual: {
      captureGapMs,
      unheardMs,
      expectedSpeechMs,
      gaps: captureGaps.gaps
        .filter(({ cause }) => cause === 'platform')
        .map(({ fromOffsetMs, untilOffsetMs }) => [
          fromOffsetMs,
          untilOffsetMs,
        ]),
      edges:
        captureGaps.gaps.filter(({ cause }) => cause === 'edge').length > 0,
    },
    expected: {
      captureGapMs: 100,
      unheardMs: 100,
      expectedSpeechMs: 5190,
      gaps: [[3000, 3100]],
      edges: true,
    },
  });
});

test('a seat that went quiet is no loss of the platform', async () => {
  const quiet = await shortfallOf(
    [
      [1934, 3000],
      [3100, 5164],
    ],
    false,
  );
  const { captureGapMs, unheardMs } = frozenCaptureColumns(quiet.capture);
  const { captureGaps } = quiet;
  assert({
    given: 'a coverage gap alone, with nothing lost by the platform',
    should:
      'state it neutrally, not as the platform fault, and still count it unheard',
    actual: {
      captureGapMs,
      unheardMs,
      causes: [...new Set(captureGaps.gaps.map(({ cause }) => cause))].sort(),
    },
    expected: {
      captureGapMs: 0,
      unheardMs: 100,
      causes: ['edge', 'unattributed'],
    },
  });
});

/** A worker dies part way through a stream, and its takeover seals the stream whole. */
const takenOverShortfall = (resumedAtMs = 3000) => {
  let result:
    | (Awaited<ReturnType<typeof readCaptureShortfall>> & {
        readonly sealed: string;
      })
    | null = null;
  return withBoundedRound(async (fixture, transaction, roundId) => {
    const { store, lease, stream, clip, start } = await historicalCapture(
      fixture,
      transaction,
      roundId,
      1000,
      60_000,
      { durationMs: 5190 },
    );
    const at = (ms: number) => new Date(start.getTime() + ms).toISOString();
    await store.claimMediaWorkerLease({ ...lease, leaseMs: 15000 });
    await store.appendCapturedTranscript({
      ...clip,
      startOffsetMs: 2034,
      durationMs: 500,
      before: at(2033),
      after: at(2535),
    });
    await store.observeCapturedStream({
      ...stream,
      trackId: clip.trackId,
      observedFrom: at(1934),
      observedUntil: at(3000),
    });
    await fixture.sql.unsafe(
      `update media_worker_leases set expires_at=clock_timestamp() - interval '1 second' where session_id=$1`,
      [lease.sessionId],
    );
    const takeover = await store.claimMediaWorkerLease({
      ...lease,
      leaseMs: 15000,
    });
    const next = { ...stream, epoch: takeover.epoch };
    await store.observeCapturedStream({
      ...next,
      trackId: createId(),
      observedFrom: at(resumedAtMs),
      observedUntil: at(5164),
    });
    const sealed = await store.sealCapturedStream({
      ...next,
      expectedChunkCount: 0,
      framesLost: false,
    });
    result = {
      sealed: sealed.state,
      ...(await transaction((tx) =>
        readCaptureShortfall(tx as never, roundId, captureRule),
      )),
    };
  }).then(() => result!);
};

test('a capture takeover with no gap is judged', async () => {
  const shortfall = await takenOverShortfall();
  assert({
    given: 'a stream relaunched mid-speech, whole, with zero gaps',
    should: 'measure a gap of zero and dispatch the AI judge',
    actual: {
      sealed: shortfall.sealed,
      gapMs: frozenCaptureColumns(shortfall.capture).captureGapMs,
      dispatch: freezeJudgingPlan({
        completeness: 'incomplete',
        humanJudges: false,
        capture: shortfall.capture,
        ballotDeadlineMs: 60_000,
        aiJudgingBudgetMs: 60_000,
      }).dispatchAiJudges,
    },
    expected: { sealed: 'partial', gapMs: 0, dispatch: true },
  });
});

test("a takeover's gap is the platform's, and stated", async () => {
  const shortfall = await takenOverShortfall(3400);
  assert({
    given: 'a stream relaunched mid-speech with 400 ms unheard',
    should: 'measure it, state it, and call it lost audio',
    actual: {
      gapMs: frozenCaptureColumns(shortfall.capture).captureGapMs,
      unheard: frozenCaptureColumns(shortfall.capture).unheardMs,
      gaps: shortfall.captureGaps.gaps.filter(
        ({ cause }) => cause === 'platform',
      ).length,
    },
    expected: { gapMs: 400, unheard: 400, gaps: 1 },
  });
});
