import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { noopErrorReporter } from '@daisy/observability';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { createMediaWorkerClient } from '@daisy/media/worker';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withEvidenceIngress } from './necessary-evidence-ingress.test-support';
import { createMediaCaptureHandlers } from '../src/features/media-capture/handlers';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';
import { silentLogger } from '../src/server/test-loggers.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('signed capture recovers a lost actual HTTP payload reply without replacing original audio or key', async () => {
  await withEvidenceIngress(async ({ f, capture, custody, body, encoded }) => {
    let seals = 0,
      adopts = 0;
    const ingress = createNecessaryEvidenceIngress({
      store: {
        ...capture,
        adoptCaptureEvidence: async (...args) => {
          adopts++;
          return capture.adoptCaptureEvidence(...args);
        },
      },
      custody: {
        ...custody,
        seal: (...args) => {
          seals++;
          return custody.seal(...args);
        },
      },
    });
    const authentication = createMediaWorkerAuthentication({
      secret: randomBytes(32).toString('base64url'),
      now: Date.now,
    });
    const handlers = createMediaCaptureHandlers({
      logger: silentLogger,
      reporter: noopErrorReporter,
      authentication: () => authentication,
      capture: () => capture,
      token: async () => {
        throw createAppError('AUTHORIZATION');
      },
      heard: async () => {},
      evidence: ingress.receive,
    });
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request) => handlers.handle(request),
    });
    let lose = true;
    const client = createMediaWorkerClient({
      scope: {
        roundId: body.roundId,
        sessionId: body.sessionId,
        workerId: body.workerId,
      },
      authentication,
      url: `http://127.0.0.1:${server.port}`,
      nowMs: performance.now,
      deadlineSignal: () => AbortSignal.timeout(5000),
      unavailableRetryMs: [],
      fetch: async (url, init) => {
        const response = await fetch(url, init);
        if (lose) {
          lose = false;
          await response.arrayBuffer();
          throw new Error('Injected lost response after actual server receipt');
        }
        return response;
      },
    });
    try {
      await assertRejects({
        given:
          'an actual signed request committed through persistent custody/PG, with its HTTP reply deliberately lost after reception',
        should: 'report no usable receipt to the producer',
        code: 'INFRASTRUCTURE',
        actual: () => client.preserve(body),
      });
      const [before] =
        await f.sql`select state,payload_accepted_at,received_at,expires_at from necessary_evidence where id=${body.evidenceId}`;
      const reply = await client.preserve(body);
      const restored = await ingress.restore({
        roundId: body.roundId,
        evidenceId: body.evidenceId,
      });
      const [after] =
        await f.sql`select state,payload_accepted_at,received_at,expires_at from necessary_evidence where id=${body.evidenceId}`;
      assert({
        given:
          'a retry of the same original signed body after unknown transport outcome (synthetic historical fixture, not played audio)',
        should:
          'recover the matching historical receipt/authenticated stored bytes with exactly one key/adoption and unchanged original expiry',
        actual: {
          kind: reply.kind,
          seals,
          adopts,
          unchanged: JSON.stringify(before) === JSON.stringify(after),
          stored: before!.state,
          original:
            restored.kind === 'restored' &&
            JSON.stringify(restored.body) === encoded.json,
        },
        expected: {
          kind: 'received',
          seals: 1,
          adopts: 1,
          unchanged: true,
          stored: 'retained',
          original: true,
        },
      });
    } finally {
      await server.stop(true);
    }
  });
});

test('signed capture without an injected evidence capability cannot activate payload or custody collection', async () => {
  await withEvidenceIngress(async ({ f, capture, body }) => {
    const authentication = createMediaWorkerAuthentication({
      secret: randomBytes(32).toString('base64url'),
      now: Date.now,
    });
    const handlers = createMediaCaptureHandlers({
      logger: silentLogger,
      reporter: noopErrorReporter,
      authentication: () => authentication,
      capture: () => capture,
      token: async () => {
        throw createAppError('AUTHORIZATION');
      },
      heard: async () => {},
    });
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request) => handlers.handle(request),
    });
    const client = createMediaWorkerClient({
      scope: {
        roundId: body.roundId,
        sessionId: body.sessionId,
        workerId: body.workerId,
      },
      authentication,
      url: `http://127.0.0.1:${server.port}`,
      nowMs: performance.now,
      deadlineSignal: () => AbortSignal.timeout(5000),
      unavailableRetryMs: [],
      fetch,
    });
    try {
      await assertRejects({
        given:
          'the actual signed route with no evidence resource configured, as in production composition',
        should: 'refuse before an intent/key/payload can be created',
        code: 'INFRASTRUCTURE',
        actual: () => client.preserve(body),
      });
      const [row] =
        await f.sql`select count(*)::int as count from necessary_evidence where id=${body.evidenceId}`;
      assert({
        given: 'the refused signed evidence request',
        should: 'leave no acquisition or payload obligation',
        actual: row!.count,
        expected: 0,
      });
    } finally {
      await server.stop(true);
    }
  });
});

test('SIGKILL with nonempty pre-WAV carry retains the actual signed original payload', async () => {
  await withEvidenceIngress(async ({ capture, custody, body, encoded }) => {
    const ingress = createNecessaryEvidenceIngress({ store: capture, custody });
    const secret = randomBytes(32).toString('base64url');
    const authentication = createMediaWorkerAuthentication({
      secret,
      now: Date.now,
    });
    const handlers = createMediaCaptureHandlers({
      logger: silentLogger,
      reporter: noopErrorReporter,
      authentication: () => authentication,
      capture: () => capture,
      token: async () => {
        throw createAppError('AUTHORIZATION');
      },
      heard: async () => {},
      evidence: ingress.receive,
    });
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request) => handlers.handle(request),
    });
    const child = Bun.spawn(
      [
        process.execPath,
        '../media-worker/src/original-frame-carry.process.test-support.ts',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          EVIDENCE_PROCESS_TEST_SECRET: secret,
          EVIDENCE_PROCESS_TEST_URL: `http://127.0.0.1:${server.port}`,
        },
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    child.stdin.write(encoded.json);
    child.stdin.end();
    try {
      const reader = child.stdout.getReader();
      const ready = await Promise.race([
        (async () => {
          let line = '';
          const decoder = new TextDecoder();
          while (!line.includes('\n')) {
            const item = await reader.read();
            if (item.done) return line;
            line += decoder.decode(item.value, { stream: true });
            if (line.length > 4096)
              throw new Error('Carry checkpoint exceeds bound');
          }
          return line;
        })(),
        Bun.sleep(10000).then(() => {
          throw new Error('Nonempty carry checkpoint missing');
        }),
      ]);
      if (!ready) {
        await Bun.write(
          '/tmp/result-reliability-carry-child-stderr.log',
          await new Response(child.stderr).text(),
        );
        throw new Error('Child ended before carry; diagnostic retained');
      }
      const checkpoint = JSON.parse(ready) as unknown;
      child.kill('SIGKILL');
      await child.exited;
      reader.releaseLock();
      const restored = await ingress.restore({
        roundId: body.roundId,
        evidenceId: body.evidenceId,
      });
      assert({
        given:
          'a fresh worker process receiving synthetic original native samples, committing real signed PG/custody evidence, then killed while its WAV carry remains nonempty',
        should:
          'recover the exact original bytes independently of the killed carry, without a completed WAV or fabricated hearing claim',
        actual: {
          checkpoint,
          signal: child.signalCode,
          original:
            restored.kind === 'restored' &&
            JSON.stringify(restored.body) === encoded.json,
        },
        expected: {
          checkpoint: { kind: 'durable-carry', frames: 1, wavs: 0 },
          signal: 'SIGKILL',
          original: true,
        },
      });
    } finally {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
        await child.exited;
      }
      await server.stop(true);
    }
  });
});
