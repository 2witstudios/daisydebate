import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { createMediaWorkerClient } from '@daisy/media/worker';
import { consumeCaptureClips, type QueuedClip } from './capture-consumer';
import { readCaptureHistory, type CaptureClient } from './capture-history';
import { maintainCaptureLease } from './capture-lease';
import {
  captureMemoryBudget,
  capturePendingBytes,
  CAPTURE_PENDING_TOTAL_BYTES,
} from './capture-memory';
import { validateCaptureBatch } from './capture-batch';
import { createCaptureStaging } from './capture-staging';
setupRitewayBun();

/** The real signed client over a scripted network: an Error is a failed fetch. */
const signedClient = (replies: (Response | Error)[]) => {
  const paths: string[] = [];
  const client = createMediaWorkerClient({
    scope: {
      roundId: 'r'.repeat(24),
      sessionId: 's'.repeat(24),
      workerId: 'w'.repeat(24),
    },
    url: 'http://127.0.0.1/',
    authentication: createMediaWorkerAuthentication({
      secret: Buffer.alloc(32, 6).toString('base64url'),
      now: () => 1000,
    }),
    fetch: async (url) => {
      paths.push(String(url).split('/').at(-1)!);
      const reply = replies.shift();
      if (!reply || reply instanceof Error) throw reply ?? new Error('down');
      return reply;
    },
    nowMs: () => 0,
    deadlineSignal: () => AbortSignal.timeout(2000),
    unavailableRetryMs: [],
  });
  return { client, paths };
};
const leaseOk = () =>
  Response.json({ epoch: 4, expiresAt: new Date(15000).toISOString() });

const renewal = (lease: CaptureClient['lease'], stop: AbortController) => {
  const pauses: number[] = [];
  let now = 0;
  const running = maintainCaptureLease({
    epoch: 4,
    signal: stop.signal,
    lease,
    nowMs: () => now,
    waitUntilMs: async (due) => {
      pauses.push(due - now);
      now = due;
    },
  });
  return { running, pauses };
};

test('renewal keeps asking through an outage, then stops on the first answer', async () => {
  const { client, paths } = signedClient([
    new Error('connection refused'),
    new Response('bad gateway', { status: 502 }),
    new Response('unavailable', { status: 503 }),
    leaseOk(),
    Response.json({ error: { code: 'CONFLICT' } }, { status: 409 }),
  ]);
  const { running, pauses } = renewal(client.lease, new AbortController());
  await assertRejects({
    given: 'three unanswered renewals, one renewed and then a refusal',
    should: 'end only on the refusal',
    code: 'CONFLICT',
    actual: () => running,
  });
  assert({
    given: 'the same run',
    should: 'retry quickly while unanswered and return to its cadence after',
    actual: [paths.length, pauses],
    expected: [5, [5000, 1000, 1000, 1000, 5000]],
  });
});

test('renewal stops on an answer that names a different epoch', async () => {
  const { running } = renewal(
    async () => ({ epoch: 9, expiresAt: new Date(0).toISOString() }),
    new AbortController(),
  );
  await assertRejects({
    given: 'an epoch that moved',
    should: 'refuse to continue',
    code: 'CONFLICT',
    actual: () => running,
  });
});

const historyState = {
  roundId: 'r'.repeat(24),
  sessionId: 's'.repeat(24),
  version: 1,
  serverNow: new Date(0).toISOString(),
  status: 'active',
  transcriptAdmissionCutoff: null,
  participants: [],
  segment: null,
  intervals: [],
  nextIntervalId: null,
};

test('a history read waits out an unanswering control plane without ending capture', async () => {
  const { client, paths } = signedClient([
    new Error('connection refused'),
    new Response('bad gateway', { status: 502 }),
    Response.json(historyState),
  ]);
  const read = await readCaptureHistory(
    client,
    4,
    new AbortController().signal,
  );
  assert({
    given: 'fast failures that are not this read deadline',
    should: 'restart the read until the server answers',
    actual: [paths.length, read.state.version],
    expected: [3, 1],
  });
});

test('a history read still ends on a definite refusal', async () => {
  const { client, paths } = signedClient([
    new Error('connection refused'),
    Response.json({ error: { code: 'AUTHORIZATION' } }, { status: 403 }),
  ]);
  await assertRejects({
    given: 'an outage and then a refusal',
    should: 'report the refusal',
    code: 'AUTHORIZATION',
    actual: () => readCaptureHistory(client, 4, new AbortController().signal),
  });
  assert({
    given: 'the same read',
    should: 'send nothing after the refusal',
    actual: paths.length,
    expected: 2,
  });
});

const seat = 'p'.repeat(24);
const segmentId = 'g'.repeat(24);
const at = (ms: number) => new Date(ms).toISOString();
const consumerState = {
  serverNow: at(90_000),
  segment: {
    id: segmentId,
    startedAt: at(0),
    endedAt: null,
    durationMs: 120_000,
  },
  intervals: [{ roundParticipantId: seat, startedAt: at(0), endedAt: null }],
  participants: [],
  nextIntervalId: null,
};
const heldClip = {
  roundId: 'r'.repeat(24),
  segmentId,
  roundParticipantId: seat,
  trackId: 'track',
  startOffsetMs: 1000,
  durationMs: 1000,
  before: at(1000),
  after: at(2000),
  clipKey: 'k',
  wav: new Uint8Array(4),
  bytes: 4,
} as unknown as QueuedClip;

/** One held clip through the consumer against scripted write answers. */
async function consumeOne(answers: {
  append: (Error | object)[];
  observe: (Error | object)[];
  stepMs?: number;
}) {
  const stop = new AbortController();
  const queue = [heldClip];
  const writes: unknown[] = [];
  const events: string[] = [];
  let now = 0;
  const answer =
    (list: (Error | object)[], name: string) => async (body: unknown) => {
      events.push(name);
      writes.push(body);
      const next = list.shift();
      if (next instanceof Error) throw next;
      return next ?? {};
    };
  const finished = consumeCaptureClips({
    client: {
      read: async () => ({ state: consumerState, calibration: {} }),
      append: answer(answers.append, 'append'),
      observe: answer(answers.observe, 'observe'),
    } as unknown as CaptureClient,
    epoch: 4,
    voice: { transcribe: async () => ({ text: 'words' }) } as never,
    sttModel: 'stt',
    signal: stop.signal,
    nowMs: () => now,
    waitUntilMs: async (due) => {
      if (due === now + 25) stop.abort();
      now = due + (answers.stepMs ?? 0);
    },
    take: () => queue.shift(),
    straddles: () => [],
    dropped: () => undefined,
    lost: () => events.push('lost'),
    transcribed: () => undefined,
    committed: () => events.push('committed'),
    settled: () => undefined,
  });
  return { finished, writes, events };
}
const outage = () => createAppError('INFRASTRUCTURE', 'unavailable');

test('a transcribed clip stays pending through an outage and commits once it ends', async () => {
  const { finished, writes, events } = await consumeOne({
    append: [outage(), outage(), outage(), {}],
    observe: [outage(), {}],
  });
  await finished;
  assert({
    given: 'an append and an observation the control plane cannot answer',
    should: 'send them unchanged until answered, committing the clip once',
    actual: [
      events,
      new Set(writes.slice(0, 4).map((body) => JSON.stringify(body))).size,
    ],
    expected: [
      [
        'append',
        'append',
        'append',
        'append',
        'committed',
        'observe',
        'observe',
      ],
      1,
    ],
  });
});

test('a write refused for now past the outage budget is lost, not a block on every later clip', async () => {
  const forever = Array.from({ length: 2000 }, outage);
  const { finished, events } = await consumeOne({
    append: forever,
    observe: [],
    stepMs: 10_000,
  });
  await finished;
  assert({
    given: 'an append the server keeps refusing for now, on a moving clock',
    should: 'give up within the budget, record the loss and keep consuming',
    actual: [
      events.filter((event) => event === 'append').length < 20,
      events.includes('lost'),
      events.includes('committed'),
    ],
    expected: [true, true, false],
  });
});

test('a refused write ends the consumer rather than being retried', async () => {
  const { finished, events } = await consumeOne({
    append: [createAppError('CONFLICT', 'Capture worker lease expired')],
    observe: [],
  });
  await assertRejects({
    given: 'an append the server refused',
    should: 'surface the refusal',
    code: 'CONFLICT',
    actual: () => finished,
  });
  assert({
    given: 'the same write',
    should: 'send it once and count that clip as lost',
    actual: events,
    expected: ['append', 'lost'],
  });
});

test('only frames dropped by the bound count as lost', () => {
  const lost: string[] = [];
  let dropped = 0;
  const state = {
    state: {
      segment: {
        id: segmentId,
        startedAt: at(0),
        endedAt: null,
        durationMs: 1_000_000,
      },
      participants: [{ identity: 'i', roundParticipantId: seat }],
      intervals: [
        { roundParticipantId: seat, startedAt: at(0), endedAt: null },
      ],
    },
    calibration: {
      sentAtMs: 0,
      receivedAtMs: 0,
      serverNowMs: 500_000,
      precisionMs: 1,
    },
  } as never;
  const staging = createCaptureStaging({
    current: () => state,
    dropped: (n) => {
      dropped += n;
    },
    lost: (frame) => lost.push(frame.seat),
    retained: () => undefined,
    maxFrames: 2,
  });
  const frame = (sequence: number, identity = 'i') =>
    staging.observe({
      identity,
      trackId: 'track',
      sequence,
      beforeMs: 10 * sequence,
      afterMs: 10 * sequence + 1,
      pcm: new Int16Array(160),
    } as never);
  frame(1, 'someone-else');
  const refusedLost = lost.length;
  for (const sequence of [1, 2, 3, 4]) frame(sequence);
  assert({
    given: 'a refused frame, then four held frames over a bound of two',
    should: 'keep the newest two and mark only the overflow lost',
    actual: [refusedLost, lost, dropped, staging.take().length],
    expected: [0, [seat, seat], 3, 2],
  });
});

test('a backlog past one cut cuts in pieces, as one run', async () => {
  const startMs = 1000;
  const frames = Array.from({ length: 30_000 }, (_, index) => {
    const at = startMs + index * 10;
    return {
      seat,
      segmentId,
      frame: {
        pcm: new Int16Array(160).fill(8000),
        trackId: 'track',
        nominalStartMs: at,
        beforeMs: at,
        afterMs: at + 10,
      },
    };
  });
  const clips: { durationMs: number; startOffsetMs: number }[] = [];
  let dropped = 0;
  await validateCaptureBatch({
    frames,
    current: {
      state: {
        ...consumerState,
        serverNow: at(1_000_000),
        segment: { ...consumerState.segment, durationMs: 1_000_000 },
      },
      calibration: {},
    } as never,
    client: {} as never,
    roundId: 'r'.repeat(24),
    epoch: 4,
    signal: new AbortController().signal,
    dropped: (n) => {
      dropped += n;
    },
    straddled: () => undefined,
    clip: (clip) => clips.push(clip),
    held: () => undefined,
    carries: new Map(),
  });
  const span = clips.reduce((sum, clip) => sum + clip.durationMs, 0);
  assert({
    given: 'five minutes of one seat held through an outage',
    should: 'refuse nothing, and cut contiguous clips up to its carry',
    actual: [
      dropped,
      clips[0]!.startOffsetMs,
      span,
      clips.every(
        (clip, index) =>
          index === 0 ||
          clip.startOffsetMs ===
            clips[index - 1]!.startOffsetMs + clips[index - 1]!.durationMs,
      ),
    ],
    expected: [0, 1000, 300_000 - span === 0 ? 300_000 : span, true],
  });
});

test('pending audio stays within the worker total however many sessions run', () => {
  const total = (sessions: number) => {
    const pending = capturePendingBytes(sessions);
    const budget = captureMemoryBudget(pending);
    return budget.maxStagedFrames * 320 + budget.maxQueueBytes;
  };
  assert({
    given: 'the default and the largest session counts',
    should: 'keep the sum over every session within the total',
    actual: [1, 8, 64].map(
      (sessions) => total(sessions) * sessions <= CAPTURE_PENDING_TOTAL_BYTES,
    ),
    expected: [true, true, true],
  });
  assert({
    given: 'the default eight sessions',
    should: 'hold two minutes for two seats',
    actual: captureMemoryBudget(capturePendingBytes(8)).maxStagedFrames,
    expected: 24_000,
  });
  assert({
    given: 'the same budget',
    should: 'let the queue take everything staged at once',
    actual: captureMemoryBudget(capturePendingBytes(8)).maxQueueMs >= 240_000,
    expected: true,
  });
});
