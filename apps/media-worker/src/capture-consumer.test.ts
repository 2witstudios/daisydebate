import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { CaptureClient } from './capture-history';
import { consumeCaptureClips, type QueuedClip } from './capture-consumer';

setupRitewayBun();

const at = (ms: number) => new Date(Date.UTC(2026, 9, 22, 12, 0, 0, ms));
const seat = 's'.repeat(24);
const segmentId = 'g'.repeat(24);
const state = {
  version: 1,
  serverNow: at(9000).toISOString(),
  nextIntervalId: null,
  participants: [],
  segment: {
    id: segmentId,
    startedAt: at(0).toISOString(),
    endedAt: null,
    durationMs: 60_000,
  },
  intervals: [
    {
      roundParticipantId: seat,
      startedAt: at(0).toISOString(),
      endedAt: null,
    },
  ],
};
const clip = (beforeMs: number, afterMs: number): QueuedClip =>
  ({
    roundId: 'r'.repeat(24),
    segmentId,
    roundParticipantId: seat,
    trackId: 'track',
    startOffsetMs: beforeMs,
    durationMs: afterMs - beforeMs,
    before: at(beforeMs).toISOString(),
    after: at(afterMs).toISOString(),
    clipKey: 'k',
    wav: new Uint8Array(4),
    bytes: 4,
  }) as unknown as QueuedClip;

/** Runs the consumer over queued clips with scripted transcripts until the queue drains. */
async function consume(
  clips: readonly QueuedClip[],
  transcripts: readonly (string | Error)[],
  evidence: readonly {
    nominalStartMs: number;
    beforeMs: number;
    afterMs: number;
  }[] = [],
) {
  const calls: string[] = [];
  const observed: unknown[] = [];
  const queue = [...clips];
  const replies = [...transcripts];
  const stop = new AbortController();
  const client = {
    read: async () => ({ state, calibration: {} }),
    append: async () => {
      calls.push('append');
      return {};
    },
    observe: async (observation: unknown) => {
      calls.push('observe');
      observed.push(observation);
      return {};
    },
  } as unknown as CaptureClient;
  const result = await consumeCaptureClips({
    client,
    epoch: 3,
    voice: {
      transcribe: async () => {
        const reply = replies.shift()!;
        if (reply instanceof Error) throw reply;
        return { text: reply };
      },
    } as never,
    sttModel: 'stt',
    signal: stop.signal,
    nowMs: () => 0,
    waitUntilMs: async () => stop.abort(),
    take: () => queue.shift(),
    straddles: () => evidence,
    dropped: () => {},
    transcribed: () => {},
    committed: () => {},
    settled: () => {},
  }).then(
    () => 'drained',
    (error: Error) => error.message,
  );
  return { calls, observed, result };
}

test('a transcribed clip records the window it captured, speech or silence', async () => {
  const { calls, observed } = await consume(
    [clip(1000, 3000), clip(3000, 5000)],
    ['We should.', ''],
  );
  assert({
    given: 'one spoken clip and one silent clip on a bound seat',
    should:
      'append the speech, then observe both clip windows on the same stream',
    actual: { calls, observed },
    expected: {
      calls: ['append', 'observe', 'observe'],
      observed: [
        {
          epoch: 3,
          segmentId,
          roundParticipantId: seat,
          trackId: 'track',
          observedFrom: at(1000).toISOString(),
          observedUntil: at(3000).toISOString(),
        },
        {
          epoch: 3,
          segmentId,
          roundParticipantId: seat,
          trackId: 'track',
          observedFrom: at(3000).toISOString(),
          observedUntil: at(5000).toISOString(),
        },
      ],
    },
  });
});

test('a speech-to-text failure leaves its window unobserved', async () => {
  const { calls, result } = await consume(
    [clip(1000, 3000)],
    [new Error('stt unavailable')],
  );
  assert({
    given: 'a clip whose transcription fails',
    should: 'claim no coverage for it and surface the failure',
    actual: { calls, result },
    expected: { calls: [], result: 'stt unavailable' },
  });
});

test('a clip outside its seat grant is dropped without coverage', async () => {
  const { calls } = await consume([clip(9500, 9800)], ['late']);
  assert({
    given: 'a clip that ends after the fresh server time',
    should: 'drop it without transcribing, appending or observing',
    actual: calls,
    expected: [],
  });
});

test('contiguous edge evidence extends the observed window to the grant start', async () => {
  const t0 = at(0).getTime();
  const { observed } = await consume(
    [clip(10, 3000)],
    ['Opening.'],
    [{ nominalStartMs: t0, beforeMs: t0 - 1, afterMs: t0 + 11 }],
  );
  assert({
    given:
      'the first clip of a grant and a contiguous frame on its track crossing the grant start',
    should: 'observe from the grant start',
    actual: (observed[0] as { observedFrom: string }).observedFrom,
    expected: at(0).toISOString(),
  });
});
