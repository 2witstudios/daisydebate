import { assert, setupRitewayBun, test } from 'riteway/bun';
import { cutCaptureClips } from '@daisy/media/clips';
import { createCaptureStaging, type StagedFrame } from './capture-staging';
import type { CaptureClient } from './capture-history';
setupRitewayBun();
const iso = (ms: number) => new Date(ms).toISOString();
function fixture() {
  let now = 0,
    dropped = 0,
    retained = 0;
  const state: Awaited<ReturnType<CaptureClient['read']>> = {
    calibration: {
      sentAtMs: 0,
      receivedAtMs: 1,
      serverNowMs: 10000,
      precisionMs: 1,
    },
    state: {
      roundId: 'r'.repeat(24),
      sessionId: 's'.repeat(24),
      version: 1,
      serverNow: iso(10001),
      status: 'active',
      transcriptAdmissionCutoff: null,
      participants: [
        {
          roundParticipantId: 'p'.repeat(24),
          identity: 'i'.repeat(24),
          kind: 'human',
        },
      ],
      segment: {
        id: 'g'.repeat(24),
        sequence: 0,
        type: 'speech',
        startedAt: iso(9000),
        endedAt: null,
        durationMs: 60000,
      },
      intervals: [
        {
          id: 'a'.repeat(24),
          roundParticipantId: 'p'.repeat(24),
          startedAt: iso(10000),
          endedAt: null,
          startedVersion: 1,
          endedVersion: null,
        },
      ],
      nextIntervalId: null,
    },
  };
  const staging = createCaptureStaging({
    current: () => state,
    nowMs: () => now,
    dropped: (n) => {
      dropped += n;
    },
    retained: () => {
      retained++;
    },
  });
  const observe = (sequence: number, beforeMs: number) => {
    now = beforeMs + 0.1;
    staging.observe({
      identity: 'i'.repeat(24),
      trackId: 'real-track',
      sequence,
      beforeMs,
      afterMs: now,
      pcm: new Int16Array(160).fill(7),
    });
  };
  return {
    state,
    staging,
    observe,
    expire: () => {
      now += 501;
    },
    counts: () => ({ dropped, retained }),
  };
}
test('private staging never retains conversation or a closed-edge window for a future grant', () => {
  const f = fixture(),
    segment = f.state.state.segment!;
  f.state.state.segment = null;
  f.observe(0, 10);
  f.observe(1, 20.2);
  f.state.state.segment = segment;
  f.state.state.intervals[0]!.endedAt = iso(10010);
  f.observe(2, 30.4);
  f.observe(3, 40.6);
  f.state.state.intervals[0]!.endedAt = null;
  assert({
    given:
      'conversation callbacks and full brackets crossing a closed grant edge',
    should: 'retain no PCM for a later grant',
    actual: { frames: f.staging.take().length, ...f.counts() },
    expected: { frames: 0, dropped: 4, retained: 0 },
  });
});
test('private staged PCM keeps original timing and expires before clip encoding', () => {
  const f = fixture();
  f.observe(0, 10);
  f.observe(1, 20.2);
  const frame = f.staging.take()[0]!;
  f.observe(2, 30.4);
  f.expire();
  assert({
    given:
      'one genuine bounded bracket then an authorization staging delay over500ms',
    should: 'keep the original copied frame and discard stale remaining PCM',
    actual: {
      seat: frame.seat,
      segment: frame.segmentId,
      observedAt: frame.observedAtMs,
      original: frame.original,
      pcm: frame.frame.pcm[0],
      stale: f.staging.take().length,
    },
    expected: {
      seat: 'p'.repeat(24),
      segment: 'g'.repeat(24),
      observedAt: 20.3,
      original: { sequence: 1, beforeMs: 20.2, afterMs: 20.3 },
      pcm: 7,
      stale: 0,
    },
  });
});
test('a refused frame crossing a grant edge is kept as edge evidence for its track', () => {
  const f = fixture();
  f.state.state.intervals[0]!.startedAt = iso(10015);
  f.observe(0, 10);
  f.observe(1, 20.2);
  f.observe(2, 30.4);
  f.observe(3, 40.6);
  const admitted = f.staging.take().map((s) => s.frame.nominalStartMs);
  const evidence = f.staging.straddles('real-track');
  f.staging.closeTrack('real-track');
  assert({
    given:
      'a frame bracket crossing the grant start, then frames inside the grant',
    should:
      'refuse the crossing frame from capture but keep it as start evidence, and forget it when the track closes',
    actual: {
      admitted,
      evidence,
      afterClose: f.staging.straddles('real-track'),
    },
    expected: {
      admitted: [10019, 10029],
      evidence: [{ nominalStartMs: 10009, beforeMs: 10008, afterMs: 10022 }],
      afterClose: [],
    },
  });
});

/**
 * Three seconds of 10 ms frames, starting well inside the grant, with a
 * calibration refresh every 250 ms whose server sample lands anywhere in its
 * round trip and native callbacks jittered by up to 2.6 ms. `missing` native
 * sequences never arrive (DEC-215).
 */
function jitteredRun(rttMs: number, missing: readonly number[] = []) {
  const f = fixture();
  const jitter = [0.2, 1.7, 0.9, 2.6, 0.4, 1.3, 2.1, 0.6];
  const calibrate = (at: number, sample: number) => {
    f.state.calibration = {
      sentAtMs: at - rttMs - 1,
      receivedAtMs: at - 1,
      serverNowMs: 10000 + at - rttMs - 1 + sample,
      precisionMs: 1,
    };
    f.staging.refresh(f.state.calibration);
  };
  calibrate(150, 0);
  const staged: StagedFrame['frame'][] = [];
  for (let sequence = 0; sequence < 300; sequence++) {
    const at = 200 + sequence * 10;
    if (sequence > 0 && sequence % 25 === 0)
      calibrate(at, jitter[(sequence / 25) % jitter.length]! % rttMs);
    if (!missing.includes(sequence))
      f.observe(sequence, at + jitter[sequence % jitter.length]!);
    staged.push(...f.staging.take().map((s) => s.frame));
  }
  const starts = staged.map((frame) => frame.nominalStartMs);
  const gaps = starts
    .slice(1)
    .map((start, i) => start - starts[i]! - 10)
    .filter((gap) => gap !== 0);
  const { clips, droppedFrames } = cutCaptureClips({
    roundId: f.state.state.roundId,
    roundParticipantId: 'p'.repeat(24),
    serverNowMs: 20000,
    segments: [
      {
        id: 'g'.repeat(24),
        startedAtMs: 9000,
        endedAtMs: null,
        durationMs: 60000,
      },
    ],
    intervals: [
      {
        segmentId: 'g'.repeat(24),
        roundParticipantId: 'p'.repeat(24),
        startedAtMs: 10000,
        endedAtMs: null,
      },
    ],
    frames: staged,
  });
  return {
    gaps,
    dropped: f.counts().dropped,
    clips: clips.length,
    clipDrops: droppedFrames,
  };
}

test('fully received jittered speech is one gap-free run at any round trip (DEC-215, ISSUE-466-r4, ISSUE-466-r5)', () => {
  assert({
    given:
      'three seconds of fully received jittered frames under 2, 30 and 100 ms round trips, recalibrated every 250 ms',
    should:
      'stage every frame in one run whose clip the frame-bracket rule accepts, with no gap and no drop',
    actual: [jitteredRun(2), jitteredRun(30), jitteredRun(100)],
    expected: Array(3).fill({ gaps: [], dropped: 0, clips: 1, clipDrops: 0 }),
  });
});

test('each missing sequence number is exactly a 10 ms gap (DEC-215)', () => {
  const missing = (count: number) =>
    jitteredRun(
      30,
      Array.from({ length: count }, (_, i) => 150 + i),
    );
  assert({
    given:
      'two, three and seven missing frames mid-run under a 30 ms round trip',
    should: 'expose exactly one 20, 30 and 70 ms gap and cut the clip there',
    actual: [missing(2), missing(3), missing(7)].map(({ gaps, clips }) => ({
      gaps,
      clips,
    })),
    expected: [
      { gaps: [20], clips: 2 },
      { gaps: [30], clips: 2 },
      { gaps: [70], clips: 2 },
    ],
  });
});
test('a requeue never lets staging grow past its bound', () => {
  const f = fixture();
  f.observe(0, 10);
  f.observe(1, 20.2);
  const held = f.staging.take()[0]!;
  f.observe(2, 30.4);
  const before = f.counts().dropped;
  f.staging.requeue(Array.from({ length: 4096 }, () => held));
  f.observe(3, 40.6);
  assert({
    given:
      'one staged frame, 4096 held frames requeued ahead of it, then one more observed',
    should:
      'keep at most 4096 frames, dropping and counting the oldest (VIDEO-4.1-r5)',
    actual: {
      frames: f.staging.take().length,
      dropped: f.counts().dropped - before,
    },
    expected: { frames: 4096, dropped: 2 },
  });
});
