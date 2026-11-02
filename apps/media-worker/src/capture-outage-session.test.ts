import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { createMediaWorkerClient } from '@daisy/media/worker';
import { consumeCaptureClips } from './capture-consumer';
import { runCaptureSession } from './capture-session';
setupRitewayBun();

const ids = {
  roundId: 'r'.repeat(24),
  sessionId: 's'.repeat(24),
  workerId: 'w'.repeat(24),
};
const seat = 'p'.repeat(24);
const identity = 'i'.repeat(24);
const segmentId = 'g'.repeat(24);
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * The real session, signed client, staging, cutting and consumer against a web
 * app the test takes down and brings back. The lease is really 15 s and the
 * outage is short, so `expired` scripts what the server answers after one.
 */
function webApp(startedAtMs: number) {
  const log: { op: string; body: Record<string, unknown> }[] = [];
  const web = { up: true, expired: false };
  const reply = (op: string, body: Record<string, unknown>) => {
    if (op === 'lease') {
      web.expired = false;
      return Response.json({
        epoch: 4,
        expiresAt: new Date(Date.now() + 15000).toISOString(),
      });
    }
    if (web.expired && op !== 'release')
      return Response.json({ refusal: 'lease-expired' }, { status: 503 });
    if (op === 'token')
      return Response.json({
        sessionId: ids.sessionId,
        roomName: 'o'.repeat(24),
        identity: 'c'.repeat(24),
        url: 'wss://media.invalid',
        token: 'token',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
    if (op === 'read')
      return Response.json({
        roundId: ids.roundId,
        sessionId: ids.sessionId,
        version: 1,
        serverNow: new Date().toISOString(),
        status: 'active',
        transcriptAdmissionCutoff: null,
        participants: [{ roundParticipantId: seat, kind: 'human', identity }],
        segment: {
          id: segmentId,
          sequence: 0,
          type: 'speech',
          startedAt: new Date(startedAtMs).toISOString(),
          endedAt: null,
          durationMs: 3_600_000,
        },
        intervals: [
          {
            id: 'n'.repeat(24),
            roundParticipantId: seat,
            startedAt: new Date(startedAtMs).toISOString(),
            endedAt: null,
            startedVersion: 1,
            endedVersion: null,
          },
        ],
        nextIntervalId: null,
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
  const app = webApp(Date.now() - 1000);
  const stop = new AbortController();
  const client = createMediaWorkerClient({
    scope: ids,
    url: 'http://127.0.0.1/',
    authentication: createMediaWorkerAuthentication({
      secret: Buffer.alloc(32, 6).toString('base64url'),
      now: Date.now,
    }),
    fetch: app.fetch,
    nowMs: Date.now,
    deadlineSignal: () => AbortSignal.timeout(3000),
    unavailableRetryMs: [0],
  });
  let frames: ReturnType<typeof setInterval> | undefined;
  const running = runCaptureSession(
    {
      roundId: ids.roundId,
      client,
      voice: { transcribe: async () => ({ text: 'words' }) } as never,
      sttModel: 'stt',
      pendingBytes: input.pendingBytes,
      nowMs: Date.now,
      // Long pauses shrink so renewal comes round inside a short test.
      waitUntilMs: async (due, signal) => {
        const wait = Math.min(Math.max(1, due - Date.now()), 40);
        if (!signal.aborted) await sleep(wait);
      },
      subscribe: (async (setup: { onFrame: (frame: never) => void }) => {
        let sequence = 0;
        const beat = () => {
          const now = Date.now();
          setup.onFrame({
            identity,
            trackId: 'track',
            sequence: sequence++,
            beforeMs: now - 1,
            afterMs: now,
            pcm: new Int16Array(160),
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
  const observed = app.log
    .filter((entry) => entry.op === 'observe')
    .map(
      (entry) =>
        [
          Date.parse(String(entry.body.observedFrom)),
          Date.parse(String(entry.body.observedUntil)),
        ] as const,
    );
  return { app, ended, observed };
}

const longestHoleMs = (spans: readonly (readonly [number, number])[]) =>
  [...spans]
    .sort((a, b) => a[0] - b[0])
    .reduce(
      (hole, span, index, all) =>
        index === 0 ? hole : Math.max(hole, span[0] - all[index - 1]![1]),
      0,
    );

test('audio heard during a web outage commits after it, with no hole and the same epoch', async () => {
  const { app, ended, observed } = await outageRun({
    pendingBytes: 32 * 1024 * 1024,
    script: async ({ web }) => {
      web.up = false;
      await sleep(700);
      web.expired = true;
      web.up = true;
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
      longestHoleMs(observed),
      app.log.at(-1)?.op,
    ],
    expected: [false, true, 1, false, 0, 'release'],
  });
});

test('frames the memory bound drops are lost out loud, and leave a real hole', async () => {
  const { app, observed } = await outageRun({
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
    actual: [seal?.body.framesLost, longestHoleMs(observed) > 200],
    expected: [true, true],
  });
});
