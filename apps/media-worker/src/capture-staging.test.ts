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
      pcm: frame.frame.pcm[0],
      stale: f.staging.take().length,
    },
    expected: {
      seat: 'p'.repeat(24),
      segment: 'g'.repeat(24),
      observedAt: 20.3,
      pcm: 7,
      stale: 0,
    },
  });
});
