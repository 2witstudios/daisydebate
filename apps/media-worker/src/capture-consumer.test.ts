import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { CaptureClient } from './capture-history';
import { createOpenRouter } from '@daisy/ai-voice';
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
    {
      roundParticipantId: 'o'.repeat(24),
      startedAt: at(0).toISOString(),
      endedAt: null,
    },
  ],
};
const clip = (beforeMs: number, afterMs: number, owner = seat): QueuedClip =>
  ({
    roundId: 'r'.repeat(24),
    segmentId,
    roundParticipantId: owner,
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
  const waits: number[] = [];
  let dropped = 0;
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
        calls.push('transcribe');
        const reply = replies.shift()!;
        if (reply instanceof Error) throw reply;
        return { text: reply };
      },
    } as never,
    sttModel: 'stt',
    signal: stop.signal,
    nowMs: () => 0,
    // The idle poll (25 ms) ends the run once the queue drains; others are retry pauses.
    waitUntilMs: async (due) => {
      if (due === 25) stop.abort();
      else waits.push(due);
    },
    take: () => queue.shift(),
    straddles: () => evidence,
    dropped: (n) => {
      dropped += n;
    },
    transcribed: () => {},
    committed: () => {},
    settled: () => {},
  }).then(
    () => 'drained',
    (error: Error) => error.message,
  );
  return {
    calls: calls.filter((call) => call !== 'transcribe'),
    transcribes: calls.filter((call) => call === 'transcribe').length,
    observed,
    result,
    waits,
    dropped,
  };
}
/** The adapter's own failure for a vendor answer of `status`. */
const providerFailure = (status: number) =>
  createOpenRouter({
    apiKey: 'key',
    fetch: async () => new Response('refused', { status }),
  })
    .transcribe({ model: 'stt', audioBase64: 'AAAA', format: 'wav' })
    .then(
      () => new Error('answered'),
      (error: Error) => error,
    );

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

test('a speech-to-text failure leaves its window unobserved and the consumer running', async () => {
  const { calls, result, dropped } = await consume(
    [clip(1000, 3000)],
    [await providerFailure(400)],
  );
  assert({
    given: 'a clip whose transcription the vendor refuses',
    should:
      'claim no coverage for it, count its frames dropped and keep consuming (VIDEO-4.1-r8)',
    actual: { calls, result, dropped },
    expected: { calls: [], result: 'drained', dropped: 200 },
  });
});

test('an uncertain transcription is retried through bounded pauses', async () => {
  const failure = await providerFailure(503);
  const recovered = await consume(
    [clip(1000, 3000)],
    [failure, await providerFailure(429), 'words'],
  );
  const exhausted = await consume(
    [clip(1000, 3000), clip(3000, 4000)],
    [failure, failure, failure, failure, 'next'],
  );
  assert({
    given:
      'a 503 then a 429 then words; and an outage that outlasts every retry before a second clip',
    should:
      'retry after 500 ms and 1 s and keep the words; after four failures drop only that clip and transcribe the next (VIDEO-4.1-r8)',
    actual: {
      recovered: [recovered.calls, recovered.waits, recovered.result],
      exhausted: [
        exhausted.transcribes,
        exhausted.waits,
        exhausted.dropped,
        exhausted.calls,
        exhausted.result,
      ],
    },
    expected: {
      recovered: [['append', 'observe'], [500, 1000], 'drained'],
      exhausted: [5, [500, 1000, 2000], 200, ['append', 'observe'], 'drained'],
    },
  });
});

test("a definite refusal fails only that clip's stream, never another seat", async () => {
  const other = 'o'.repeat(24);
  const { transcribes, calls, dropped, result } = await consume(
    [clip(1000, 2000), clip(2000, 3000), clip(1000, 2000, other)],
    [await providerFailure(413), 'other seat'],
  );
  assert({
    given:
      "a seat's clip refused for good (413), that seat's next clip, then another seat's clip",
    should:
      "drop that stream's clips without retrying them and transcribe the other seat (VIDEO-4.1-r8)",
    actual: { transcribes, calls, dropped, result },
    expected: {
      transcribes: 2,
      calls: ['append', 'observe'],
      dropped: 200,
      result: 'drained',
    },
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
