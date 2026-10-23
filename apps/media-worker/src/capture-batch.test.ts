import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  flushClipCarry,
  flushQuietCarries,
  validateCaptureBatch,
  type ClipCarries,
} from './capture-batch';
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
    carries: new Map(),
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
  const carries = new Map();
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
    carries,
  });
  for (const clip of flushClipCarry(carries, 'r'.repeat(24), {
    segmentId,
    roundParticipantId: seat,
  }))
    clipped.push(clip.startOffsetMs, clip.durationMs);
  assert({
    given:
      'an open grant read at server time 10100, a frame ending at 10061 and one ending at 10101',
    should:
      'carry the first into its stream, hold the second for the next batch and drop neither (VIDEO-4.1)',
    actual: { clipped, held, dropped },
    expected: { clipped: [1050, 10], held: [10090], dropped: 0 },
  });
});

/** A seat's open grant read at server time 11000, and one 250 ms batch of its speech carried into `carries`. */
const openGrant = {
  ...current,
  state: {
    ...current.state,
    serverNow: iso(11000),
    intervals: [{ ...current.state.intervals[0]!, endedAt: null }],
  },
} as typeof current;
const speechBatch = (
  carries: ClipCarries,
  from: number,
  clip: (clip: {
    startOffsetMs: number;
    durationMs: number;
  }) => void = () => {},
) =>
  validateCaptureBatch({
    frames: Array.from({ length: 25 }, (_, i) => {
      const at = from + i * 10;
      const frame = staged(at, at - 1, at + 11);
      return {
        ...frame,
        frame: { ...frame.frame, pcm: new Int16Array(160).fill(1000) },
      };
    }),
    current: openGrant,
    client: {} as CaptureClient,
    roundId: 'r'.repeat(24),
    epoch: 1,
    signal: new AbortController().signal,
    nowMs: () => 0,
    dropped: () => {},
    straddled: () => {},
    clip,
    held: () => {},
    carries,
  });

test("a stream's consecutive batches make one clip, cut only when the stream flushes", async () => {
  const carries: ClipCarries = new Map();
  const clipped: number[] = [];
  const batch = (from: number) =>
    speechBatch(carries, from, (clip) =>
      clipped.push(clip.startOffsetMs, clip.durationMs),
    );
  await batch(10010);
  await batch(10260);
  const beforeFlush = [...clipped];
  for (const clip of flushClipCarry(carries, 'r'.repeat(24), {
    segmentId,
    roundParticipantId: seat,
  }))
    clipped.push(clip.startOffsetMs, clip.durationMs);
  assert({
    given: "two 250 ms batches of one seat's continuous speech",
    should:
      'cut no clip at the batch boundary, and one 500 ms clip at the flush (VIDEO-4.1-r7)',
    actual: { beforeFlush, clipped, left: carries.size },
    expected: { beforeFlush: [], clipped: [1010, 500], left: 0 },
  });
});

test("a stream whose frames stop ends its clip after a pause, not at its segment's end", async () => {
  const carries: ClipCarries = new Map();
  await speechBatch(carries, 10010);
  // The last carried frame ended at 10261 (server time).
  const at = (serverNowMs: number) =>
    flushQuietCarries(carries, 'r'.repeat(24), serverNowMs).map((clip) => [
      clip.startOffsetMs,
      clip.durationMs,
    ]);
  assert({
    given:
      "a seat's 250 ms of frames, then no frame at all (a bot's track after its speech)",
    should:
      'keep the clip open until the frames have been silent 500 ms, then end it, long before the segment ends (VIDEO-4.1-r7)',
    actual: { early: at(10700), paused: at(10761), left: carries.size },
    expected: { early: [], paused: [[1010, 250]], left: 0 },
  });
});
