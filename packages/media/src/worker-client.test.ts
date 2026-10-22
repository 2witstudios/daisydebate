import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createMediaWorkerClient } from './worker-client';
import { createMediaWorkerAuthentication } from './worker-auth';
setupRitewayBun();
const scope = {
  roundId: 'r'.repeat(24),
  sessionId: 's'.repeat(24),
  workerId: 'w'.repeat(24),
};
const authentication = createMediaWorkerAuthentication({
  secret: Buffer.alloc(32, 6).toString('base64url'),
  now: () => 1000,
});
function localClient(
  reply: () => Response,
  deadlineSignal = () => AbortSignal.timeout(2000),
) {
  let calls = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => {
      calls++;
      return reply();
    },
  });
  return {
    client: createMediaWorkerClient({
      scope,
      authentication,
      url: `http://127.0.0.1:${server.port}`,
      fetch,
      nowMs: performance.now,
      deadlineSignal,
    }),
    calls: () => calls,
    close: () => server.stop(true),
  };
}

test('transport deadline and caller cancellation refuse before any request', async () => {
  const deadline = new AbortController();
  deadline.abort();
  const caller = new AbortController();
  caller.abort();
  const f = localClient(
    () => Response.json({}),
    () => deadline.signal,
  );
  try {
    await assertRejects({
      given: 'an elapsed transport deadline',
      should: 'report infrastructure uncertainty without dispatch',
      actual: () => f.client.lease(15000),
      code: 'INFRASTRUCTURE',
    });
    await assertRejects({
      given: 'an explicitly cancelled caller',
      should: 'refuse as cancellation without dispatch',
      actual: () => f.client.lease(15000, caller.signal),
      code: 'CONFLICT',
    });
    assert({
      given: 'both refused requests',
      should: 'leave the transport untouched',
      actual: f.calls(),
      expected: 0,
    });
  } finally {
    await f.close();
  }
});

test('caller abort while a real HTTP response body is pending cannot return stale data', async () => {
  const entered = Promise.withResolvers<void>();
  const f = localClient(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"epoch":'));
            entered.resolve();
          },
        }),
      ),
  );
  const controller = new AbortController();
  try {
    const pending = f.client.lease(15000, controller.signal);
    await entered.promise;
    controller.abort();
    await assertRejects({
      given: 'actual Bun HTTP whose partial JSON response has begun',
      should: 'cancel pending body read without returning a stale lease',
      actual: () => pending,
      code: 'CONFLICT',
    });
  } finally {
    await f.close();
  }
});

for (const [label, reply] of [
  [
    'malformed shape',
    () => Response.json({ epoch: -1, expiresAt: 'not-a-date' }),
  ],
  ['over-sized response', () => new Response('x'.repeat(1024 * 1024 + 1))],
] as const)
  test(`untrusted worker reply: ${label}`, async () => {
    const f = localClient(reply);
    try {
      await assertRejects({
        given: label,
        should: 'refuse without exposing or retaining an unbounded reply',
        actual: () => f.client.lease(15000),
        code: 'INFRASTRUCTURE',
      });
    } finally {
      await f.close();
    }
  });
