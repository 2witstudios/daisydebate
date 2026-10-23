import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createCaptureStaging } from './capture-staging';
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
      admitted: [10020, 10030],
      evidence: [{ nominalStartMs: 10010, beforeMs: 10009, afterMs: 10022 }],
      afterClose: [],
    },
  });
});

/**
 * Three seconds of 10 ms frames with a calibration refresh every 250 ms whose
 * server sample lands anywhere in its round trip (ISSUE-466-r4), with steady
 * native callbacks. `missing` native sequences never arrive.
 */
function jitteredRun(rttMs: number, missing: readonly number[] = []) {
  const f = fixture();
  const jitter = [0.2, 1.7, 0.9, 2.6, 0.4, 1.3, 2.1, 0.6];
  const starts: number[] = [];
  // The bootstrap and each re-anchor callback land on their period edge.
  const anchors = [0, ...(missing.length ? [missing.at(-1)! + 1] : [])];
  for (let sequence = 0; sequence < 300; sequence++) {
    const at = 10 + sequence * 10;
    if (sequence > 0 && sequence % 25 === 0) {
      const sample = jitter[(sequence / 25) % jitter.length]! % rttMs;
      f.state.calibration = {
        sentAtMs: at - rttMs - 1,
        receivedAtMs: at - 1,
        serverNowMs: 10000 + at - rttMs - 1 + sample,
        precisionMs: 1,
      };
      f.staging.refresh(f.state.calibration);
    }
    if (!missing.includes(sequence))
      f.observe(sequence, anchors.includes(sequence) ? at : at + 0.2);
    starts.push(...f.staging.take().map((s) => s.frame.nominalStartMs));
  }
  const gaps = starts
    .slice(1)
    .map((start, i) => start - starts[i]! - 10)
    .filter((gap) => gap !== 0);
  return { gaps, dropped: f.counts().dropped, frames: starts.length };
}

test('fully received speech keeps one gap-free nominal run across calibration refreshes (ISSUE-466-r4)', () => {
  assert({
    given:
      'three seconds of fully received frames under 2 ms and 30 ms round trips, recalibrated every 250 ms with a jittering server sample',
    should:
      'advance the nominal timeline exactly 10 ms per frame from the run anchor, with no gap and no dropped frame beyond the anchor',
    actual: [jitteredRun(2), jitteredRun(30)],
    expected: [
      { gaps: [], dropped: 1, frames: 299 },
      { gaps: [], dropped: 1, frames: 299 },
    ],
  });
});

test('a missing frame is still a gap at least as long as the audio lost (ISSUE-466-r4)', () => {
  const shortfall = (missing: number[]) => {
    const { gaps } = jitteredRun(2, missing);
    // The new run re-anchors within the 2 ms calibration round trip.
    return gaps.length === 1 && gaps[0]! >= (missing.length + 1) * 10 - 2;
  };
  assert({
    given:
      'one, two and six consecutive frames missing mid-run (20, 30 and 70 ms with the discarded re-anchor frame)',
    should:
      'expose exactly one gap covering the lost audio, within the calibration round trip',
    actual: [
      shortfall([150]),
      shortfall([150, 151]),
      shortfall([150, 151, 152, 153, 154, 155]),
    ],
    expected: [true, true, true],
  });
});
