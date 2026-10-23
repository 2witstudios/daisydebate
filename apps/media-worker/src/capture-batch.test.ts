import { assert, setupRitewayBun, test } from 'riteway/bun';
import { validateCaptureBatch } from './capture-batch';
import type { CaptureClient } from './capture-history';
import type { StagedFrame } from './capture-staging';

setupRitewayBun();

const iso = (ms: number) => new Date(ms).toISOString();
const seat = 'p'.repeat(24);
const segmentId = 'g'.repeat(24);
const current = {
  calibration: {
    sentAtMs: 0,
    receivedAtMs: 1,
    serverNowMs: 10100,
    precisionMs: 1,
  },
  state: {
    roundId: 'r'.repeat(24),
    sessionId: 's'.repeat(24),
    version: 2,
    serverNow: iso(10100),
    status: 'active',
    transcriptAdmissionCutoff: null,
    participants: [],
    segment: {
      id: segmentId,
      sequence: 0,
      type: 'speech',
      startedAt: iso(9000),
      endedAt: null,
      durationMs: 60000,
    },
    intervals: [
      {
        id: 'a'.repeat(24),
        roundParticipantId: seat,
        startedAt: iso(10000),
        endedAt: iso(10025),
        startedVersion: 1,
        endedVersion: 2,
      },
    ],
    nextIntervalId: null,
  },
} as unknown as Awaited<ReturnType<CaptureClient['read']>>;
const staged = (
  nominalStartMs: number,
  beforeMs: number,
  afterMs: number,
): StagedFrame => ({
  seat,
  segmentId,
  observedAtMs: 0,
  original: { sequence: 0, beforeMs: 0, afterMs: 0 },
  frame: {
    pcm: new Int16Array(160),
    trackId: 'track',
    nominalStartMs,
    beforeMs,
    afterMs,
  },
});

test('a batch frame crossing a grant end the staging cache missed becomes edge evidence', async () => {
  const straddled: number[] = [];
  await validateCaptureBatch({
    frames: [staged(10010, 10009, 10021), staged(10020, 10019, 10031)],
    current,
    client: {} as CaptureClient,
    roundId: 'r'.repeat(24),
    epoch: 1,
    signal: new AbortController().signal,
    nowMs: () => 0,
    dropped: () => {},
    straddled: (frame) => straddled.push(frame.nominalStartMs),
    clip: () => {},
    held: () => {},
  });
  assert({
    given:
      'frames staged while the grant was open, the second crossing its now-known end',
    should: 'report only the crossing frame as end evidence',
    actual: straddled,
    expected: [10020],
  });
});

test('a frame newer than the history read is held for the next batch, never dropped', async () => {
  const open = {
    ...current,
    state: {
      ...current.state,
      intervals: [{ ...current.state.intervals[0]!, endedAt: null }],
    },
  } as typeof current;
  const clipped: number[] = [];
  const held: number[] = [];
  let dropped = 0;
  await validateCaptureBatch({
    frames: [staged(10050, 10049, 10061), staged(10090, 10089, 10101)],
    current: open,
    client: {} as CaptureClient,
    roundId: 'r'.repeat(24),
    epoch: 1,
    signal: new AbortController().signal,
    nowMs: () => 0,
    dropped: (n) => {
      dropped += n;
    },
    straddled: () => {},
    clip: (clip) => clipped.push(clip.startOffsetMs, clip.durationMs),
    held: (frames) => held.push(...frames.map((f) => f.frame.nominalStartMs)),
  });
  assert({
    given:
      'an open grant read at server time 10100, a frame ending at 10061 and one ending at 10101',
    should:
      'cut the first, hold the second for the next batch and drop neither (VIDEO-4.1)',
    actual: { clipped, held, dropped },
    expected: { clipped: [1050, 10], held: [10090], dropped: 0 },
  });
});
