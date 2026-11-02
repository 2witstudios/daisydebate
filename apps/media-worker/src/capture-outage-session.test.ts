import { assert, setupRitewayBun, test } from 'riteway/bun';
import { systemClock } from '@daisy/clock';
import {
  captureScope as ids,
  historyAnswer,
  longestObservationHoleMs,
  signedCaptureClient,
  tokenAnswer,
} from './capture-client.test-support';
import { consumeCaptureClips } from './capture-consumer';
import { runCaptureSession } from './capture-session';
setupRitewayBun();

const seat = 'p'.repeat(24);
const identity = 'i'.repeat(24);
const nowMs = () => Date.parse(systemClock.now());
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * The real session, signed client, staging, cutting and consumer against a web
 * app the test takes down and brings back. The lease is really 15 s and the
 * outage is short, so `expired` scripts what the server answers after one.
 */
function webApp(startedAtMs: number) {
  const log: { op: string; body: Record<string, unknown> }[] = [];
  const web = { up: true, expired: false, endedAt: null as string | null };
  const reply = (op: string, body: Record<string, unknown>) => {
    if (op === 'lease') {
      web.expired = false;
      return Response.json({
        epoch: 4,
        expiresAt: new Date(nowMs() + 15000).toISOString(),
      });
    }
    if (web.expired && op !== 'release')
      return Response.json({ refusal: 'lease-expired' }, { status: 503 });
    if (op === 'token') return tokenAnswer(nowMs());
    if (op === 'read')
      return historyAnswer({
        nowMs: nowMs(),
        startedAt: new Date(startedAtMs).toISOString(),
        endedAt: web.endedAt,
        seats: [{ id: seat, identity }],
      });
    if (op === 'append' || op === 'observe') {
      log.push({ op, body });
      return Response.json({ duplicate: false, revision: log.length });
    }
    log.push({ op, body });
    if (op === 'seal')
      return Response.json({ state: 'partial', revision: log.length });
    return Response.json(null);
  };
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (!web.up) throw new Error('connection refused');
    return reply(
      String(url).split('/').at(-1)!,
      JSON.parse(String(init!.body)) as Record<string, unknown>,
    );
  };
  return { web, log, fetch };
}

/** Runs a session hearing steady frames while `script` moves the web app. */
async function outageRun(input: {
  readonly pendingBytes: number;
  readonly script: (app: ReturnType<typeof webApp>) => Promise<void>;
}) {
  const app = webApp(nowMs() - 1000);
  const stop = new AbortController();
  const client = signedCaptureClient(app.fetch, nowMs);
  let frames: ReturnType<typeof setInterval> | undefined;
  const running = runCaptureSession(
    {
      roundId: ids.roundId,
      client,
      voice: { transcribe: async () => ({ text: 'words' }) } as never,
      sttModel: 'stt',
      pendingBytes: input.pendingBytes,
      nowMs,
      // Long pauses shrink so renewal comes round inside a short test.
      waitUntilMs: async (due, signal) => {
        const wait = Math.min(Math.max(1, due - nowMs()), 40);
        if (!signal.aborted) await sleep(wait);
      },
      subscribe: (async (setup: { onFrame: (frame: never) => void }) => {
        let sequence = 0;
        const beat = () => {
          const now = nowMs();
          setup.onFrame({
            identity,
            trackId: 'track',
            sequence: sequence++,
            beforeMs: now - 1,
            afterMs: now,
            pcm: new Int16Array(160).fill(sequence % 100 < 40 ? 8000 : 0),
          } as never);
        };
        frames = setInterval(beat, 10);
        return {
          closed: new Promise(() => undefined),
          setIdentities: async () => undefined,
          close: async () => clearInterval(frames),
        };
      }) as never,
      consume: consumeCaptureClips,
    },
    stop.signal,
  );
  await sleep(300);
  await input.script(app);
  await sleep(300);
  stop.abort();
  const ended = await running;
  clearInterval(frames);
  return { app, ended };
}

test('audio heard during a web outage commits after it, with no hole and the same epoch', async () => {
  const { app, ended } = await outageRun({
    pendingBytes: 32 * 1024 * 1024,
    script: async ({ web, log }) => {
      web.up = false;
      await sleep(700);
      web.expired = true;
      web.up = true;
      await sleep(600);
      // The speech ends, so its stream seals in the session's own loop.
      web.endedAt = systemClock.now();
      for (let waits = 0; waits < 200; waits++) {
        if (log.some((entry) => entry.op === 'seal')) break;
        await sleep(25);
      }
    },
  });
  const seal = app.log.find((entry) => entry.op === 'seal');
  assert({
    given: 'the web app down, then answering with an expired lease',
    should:
      'end cleanly, commit what it heard under one epoch and report nothing lost',
    actual: [
      ended.closed,
      app.log.some((entry) => entry.op === 'append'),
      new Set(app.log.map((entry) => entry.body.epoch)).size,
      seal?.body.framesLost,
      longestObservationHoleMs(app.log),
      app.log.at(-1)?.op,
    ],
    expected: [false, true, 1, false, 0, 'release'],
  });
});

test('frames the memory bound drops are lost out loud, and leave a real hole', async () => {
  const { app } = await outageRun({
    // Staged share: 30% of 32 KiB, about 300 ms of one seat.
    pendingBytes: 32 * 1024,
    script: async ({ web }) => {
      web.up = false;
      await sleep(1200);
      web.up = true;
    },
  });
  const seal = app.log.find((entry) => entry.op === 'seal');
  assert({
    given: 'an outage far longer than this session may hold',
    should: 'report the lost frames and leave the hole in its observations',
    actual: [seal?.body.framesLost, longestObservationHoleMs(app.log) > 200],
    expected: [true, true],
  });
});

test('two seats held through almost the whole budget lose nothing', async () => {
  // A virtual clock: 119 s of speech arrives while the web app is away, far
  // faster than real time, through the real staging, cutter, queue and consumer.
  let virtual = 1_000_000;
  const clock = () => virtual;
  const seats = [
    { id: 'p'.repeat(24), identity: 'i'.repeat(24) },
    { id: 'q'.repeat(24), identity: 'j'.repeat(24) },
  ];
  const startedAt = new Date(virtual - 1000).toISOString();
  const log: { op: string; body: Record<string, unknown> }[] = [];
  const web = { up: true, endedAt: null as string | null };
  const fetchWeb = async (url: string | URL | Request, init?: RequestInit) => {
    if (!web.up) throw new Error('connection refused');
    const op = String(url).split('/').at(-1)!;
    const body = JSON.parse(String(init!.body)) as Record<string, unknown>;
    if (op === 'lease')
      return Response.json({
        epoch: 4,
        expiresAt: new Date(virtual + 15000).toISOString(),
      });
    if (op === 'token') return tokenAnswer(virtual);
    if (op === 'read')
      return historyAnswer({
        nowMs: virtual,
        startedAt,
        endedAt: web.endedAt,
        seats,
      });
    log.push({ op, body });
    if (op === 'seal')
      return Response.json({ state: 'partial', revision: log.length });
    if (op === 'release') return Response.json(null);
    return Response.json({ duplicate: false, revision: log.length });
  };
  const client = signedCaptureClient(fetchWeb, clock);
  let emit: ((frame: never) => void) | undefined;
  const stop = new AbortController();
  const running = runCaptureSession(
    {
      roundId: ids.roundId,
      client,
      voice: { transcribe: async () => ({ text: 'words' }) } as never,
      sttModel: 'stt',
      pendingBytes: 32 * 1024 * 1024,
      nowMs: clock,
      waitUntilMs: async (_due, signal) => {
        if (!signal.aborted) await sleep(1);
      },
      subscribe: (async (setup: { onFrame: (frame: never) => void }) => {
        emit = setup.onFrame;
        return {
          closed: new Promise(() => undefined),
          setIdentities: async () => undefined,
          close: async () => undefined,
        };
      }) as never,
      consume: consumeCaptureClips,
    },
    stop.signal,
  );
  while (!emit) await sleep(5);
  await sleep(50);
  web.up = false;
  await sleep(50);
  const frames = 11_900;
  for (let sequence = 0; sequence < frames; sequence++) {
    virtual += 10;
    for (const seat of seats)
      emit({
        identity: seat.identity,
        trackId: `track-${seat.id}`,
        sequence,
        beforeMs: virtual - 1,
        afterMs: virtual,
        pcm: new Int16Array(160).fill(sequence % 100 < 40 ? 8000 : 0),
      } as never);
  }
  web.up = true;
  // Let the batch and the consumer take it all, then end the speech to seal.
  const heardAll = () =>
    log.filter((entry) => entry.op === 'append').length >= 2 * 110;
  for (let waits = 0; waits < 2000 && !heardAll(); waits++) await sleep(5);
  virtual += 1000;
  web.endedAt = new Date(virtual).toISOString();
  virtual += 2000;
  const sealed = () => log.filter((entry) => entry.op === 'seal').length >= 2;
  for (let waits = 0; waits < 2000 && !sealed(); waits++) await sleep(5);
  stop.abort();
  await running;
  const bySeat = seats.map((seat) => {
    const own = log.filter(
      (entry) => entry.body.roundParticipantId === seat.id,
    );
    return {
      enough: own.filter((entry) => entry.op === 'append').length >= 110,
      hole: longestObservationHoleMs(own),
      framesLost: own.find((entry) => entry.op === 'seal')?.body.framesLost,
    };
  });
  assert({
    given: 'two seats speaking through 119 s of web outage',
    should: 'commit both, with no hole and nothing lost',
    actual: bySeat,
    expected: [
      { enough: true, hole: 0, framesLost: false },
      { enough: true, hole: 0, framesLost: false },
    ],
  });
}, 60_000);
