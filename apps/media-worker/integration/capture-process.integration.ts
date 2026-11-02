import { resolve } from 'node:path';
import { OPENROUTER_E2E_PLACEHOLDER } from '@daisy/ai-voice/testing';
import { systemClock } from '@daisy/clock';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  captureScope,
  historyAnswer,
  longestObservationHoleMs,
  tokenAnswer,
} from '../src/capture-client.test-support';

setupRitewayBun();

const nowMs = () => Date.parse(systemClock.now());
const sleep = (ms: number) => Bun.sleep(ms);
const scope = {
  round: captureScope.roundId,
  session: captureScope.sessionId,
  seat: 'p'.repeat(24),
  identity: 'i'.repeat(24),
};
type Entry = {
  readonly op: string;
  readonly body: Record<string, unknown>;
  readonly at: number;
};

/** A web app that can really go away, keeping capture's lease rule and a log. */
function webApp() {
  const startedAt = new Date(nowMs() - 1000).toISOString();
  const log: Entry[] = [];
  type Lease = { workerId: string; epoch: number; expiresAt: number };
  const state: { lease?: Lease; endedAt: string | null } = { endedAt: null };
  let server: ReturnType<typeof Bun.serve> | undefined;
  let port = 0;
  const claim = (body: Record<string, unknown>) => {
    const now = nowMs();
    const current = state.lease;
    const live = current !== undefined && current.expiresAt > now;
    if (live && current.workerId !== body.workerId)
      return Response.json({ error: { code: 'CONFLICT' } }, { status: 409 });
    if (body.expectedEpoch !== undefined) {
      if (
        !current ||
        current.workerId !== body.workerId ||
        current.epoch !== body.expectedEpoch
      )
        return Response.json({ error: { code: 'CONFLICT' } }, { status: 409 });
    }
    const next: Lease = {
      workerId: String(body.workerId),
      epoch:
        live || body.expectedEpoch !== undefined
          ? current!.epoch
          : (current?.epoch ?? 0) + 1,
      expiresAt: now + Number(body.leaseMs),
    };
    state.lease = next;
    return Response.json({
      epoch: next.epoch,
      expiresAt: new Date(next.expiresAt).toISOString(),
    });
  };
  const answer = (op: string, body: Record<string, unknown>) => {
    if (op === 'lease') return claim(body);
    if (op === 'release') {
      const held = state.lease;
      if (held && held.workerId === body.workerId && held.epoch === body.epoch)
        held.expiresAt = Math.min(held.expiresAt, nowMs());
      return Response.json(null);
    }
    if ((state.lease?.expiresAt ?? 0) <= nowMs())
      return Response.json({ refusal: 'lease-expired' }, { status: 503 });
    if (op === 'token') return tokenAnswer(nowMs());
    if (op === 'read')
      return historyAnswer({
        nowMs: nowMs(),
        startedAt,
        endedAt: state.endedAt,
        seats: [{ id: scope.seat, identity: scope.identity }],
      });
    if (op === 'seal')
      return Response.json({ state: 'partial', revision: log.length });
    return Response.json({ duplicate: false, revision: log.length });
  };
  const up = () => {
    server = Bun.serve({
      port,
      hostname: '127.0.0.1',
      fetch: async (request) => {
        const op = new URL(request.url).pathname.split('/').at(-1)!;
        const body = (await request.json()) as Record<string, unknown>;
        const response = answer(op, body);
        if (response.ok) log.push({ op, body, at: nowMs() });
        return response;
      },
    });
    port = server.port!;
  };
  up();
  return {
    log,
    endSpeech: () => {
      state.endedAt = new Date(nowMs()).toISOString();
    },
    url: () => `http://127.0.0.1:${port}/`,
    up,
    down: () => server!.stop(true),
    close: () => server?.stop(true),
  };
}

const spawnCapture = (url: string, workerId: string) =>
  Bun.spawn(
    [
      process.execPath,
      resolve(import.meta.dir, 'frame-capture-entry.ts'),
      scope.round,
      scope.session,
      workerId,
    ],
    {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      env: {
        PUBLIC_APP_URL: url,
        MEDIA_WORKER_SECRET: Buffer.alloc(32, 6).toString('base64url'),
        OPENROUTER_API_KEY: OPENROUTER_E2E_PLACEHOLDER,
        CAPTURE_PENDING_BYTES: String(32 * 1024 * 1024),
        PROOF_IDENTITY: scope.identity,
      },
    },
  );
const worker = (letter: string) => letter.repeat(24);
const until = async (ready: () => boolean, ms: number) => {
  const by = nowMs() + ms;
  while (!ready() && nowMs() < by) await sleep(25);
  return ready();
};
const running = async (child: ReturnType<typeof spawnCapture>) =>
  (await Promise.race([child.exited, sleep(0).then(() => 'alive')])) ===
  'alive';
test('a real capture process outlives a web outage past its lease and loses nothing', async () => {
  const app = webApp();
  const child = spawnCapture(app.url(), worker('a'));
  try {
    await until(() => app.log.some((entry) => entry.op === 'lease'), 20_000);
    await sleep(1000);
    app.down();
    // Past the 15 s lease, as the incident's web replacement was.
    await sleep(17_000);
    const aliveThrough = await running(child);
    app.up();
    await until(
      () => app.log.filter((entry) => entry.op === 'lease').length > 1,
      10_000,
    );
    await sleep(1500);
    // The speech ends, so its stream seals in the session's own loop.
    app.endSpeech();
    await until(() => app.log.some((entry) => entry.op === 'seal'), 10_000);
    child.kill('SIGTERM');
    const code = await child.exited;
    const epochs = new Set(app.log.map((entry) => entry.body.epoch));
    epochs.delete(undefined);
    const seal = app.log.find((entry) => entry.op === 'seal');
    assert({
      given: 'its web app gone for 17 s, then a graceful stop',
      should:
        'stay up, keep one epoch, commit through the outage with no hole, report nothing lost and exit cleanly',
      actual: {
        aliveThrough,
        code,
        epochs: epochs.size,
        hole: longestObservationHoleMs(app.log),
        // One clip per second heard: the outage's speech, not a surviving tail.
        appended: app.log.filter((entry) => entry.op === 'append').length >= 18,
        framesLost: seal?.body.framesLost,
        last: app.log.at(-1)?.op,
      },
      expected: {
        aliveThrough: true,
        code: 0,
        epochs: 1,
        hole: 0,
        appended: true,
        framesLost: false,
        last: 'release',
      },
    });
  } finally {
    child.kill('SIGKILL');
    app.close();
  }
}, 60_000);

test('a stopped process hands over at once, and a killed one leaves its lease held', async () => {
  const app = webApp();
  const first = spawnCapture(app.url(), worker('b'));
  let successor: ReturnType<typeof spawnCapture> | undefined;
  let third: ReturnType<typeof spawnCapture> | undefined;
  try {
    await until(() => app.log.some((entry) => entry.op === 'read'), 20_000);
    await sleep(500);
    first.kill('SIGTERM');
    await first.exited;
    successor = spawnCapture(app.url(), worker('c'));
    const claimedAtOnce = await until(
      () =>
        app.log.some(
          (entry) =>
            entry.op === 'lease' && entry.body.workerId === worker('c'),
        ),
      10_000,
    );
    const epoch = app.log.find(
      (entry) => entry.op === 'lease' && entry.body.workerId === worker('c'),
    );
    await sleep(500);
    successor.kill('SIGKILL');
    await successor.exited;
    third = spawnCapture(app.url(), worker('d'));
    const thirdEnded = await Promise.race([
      third.exited.then(() => true),
      sleep(10_000).then(() => false),
    ]);
    assert({
      given: 'a graceful stop, then a kill that cannot release',
      should:
        'let the successor claim immediately, and refuse the next while the killed lease lives',
      actual: {
        claimedAtOnce,
        release: app.log.some((entry) => entry.op === 'release'),
        claimedNext: epoch !== undefined,
        refusedWhileHeld: thirdEnded,
        thirdClaimed: app.log.some(
          (entry) =>
            entry.op === 'lease' && entry.body.workerId === worker('d'),
        ),
      },
      expected: {
        claimedAtOnce: true,
        release: true,
        claimedNext: true,
        refusedWhileHeld: true,
        thirdClaimed: false,
      },
    });
  } finally {
    first.kill('SIGKILL');
    successor?.kill('SIGKILL');
    third?.kill('SIGKILL');
    app.close();
  }
}, 60_000);
