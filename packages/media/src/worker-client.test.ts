import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  createMediaWorkerClient,
  isOpenTimelineRefusal,
} from './worker-client';
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
  reply: (call: number) => Response,
  deadlineSignal = () => AbortSignal.timeout(2000),
) {
  let calls = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => reply(++calls),
  });
  return {
    client: createMediaWorkerClient({
      scope,
      authentication,
      url: `http://127.0.0.1:${server.port}`,
      fetch,
      nowMs: performance.now,
      deadlineSignal,
      unavailableRetryMs: [0, 0],
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

const lease = { epoch: 3, expiresAt: '2026-10-22T12:00:15.000Z' };

test('a refused-for-now 503 is retried and the next answer is used', async () => {
  const f = localClient((call) =>
    call === 1 ? new Response(null, { status: 503 }) : Response.json(lease),
  );
  try {
    assert({
      given: 'a capacity 503 then a valid lease reply',
      should: 'retry the signed call once and return the lease',
      actual: [await f.client.lease(15000), f.calls()],
      expected: [lease, 2],
    });
  } finally {
    await f.close();
  }
});

test('a lasting 503 is reported after the bounded retries', async () => {
  const f = localClient(() => new Response(null, { status: 503 }));
  try {
    await assertRejects({
      given: 'a server that keeps answering 503',
      should: 'report infrastructure unavailability',
      actual: () => f.client.lease(15000),
      code: 'INFRASTRUCTURE',
    });
    assert({
      given: 'two configured retries',
      should: 'make three attempts in all',
      actual: f.calls(),
      expected: 3,
    });
  } finally {
    await f.close();
  }
});

test('a refusal other than 503 is never retried', async () => {
  const f = localClient(() => new Response(null, { status: 409 }));
  try {
    await assertRejects({
      given: 'a 409 capture refusal',
      should: 'report the conflict at once',
      actual: () => f.client.lease(15000),
      code: 'CONFLICT',
    });
    assert({
      given: 'the conflict',
      should: 'make exactly one attempt',
      actual: f.calls(),
      expected: 1,
    });
  } finally {
    await f.close();
  }
});

const sealing = {
  epoch: 3,
  segmentId: 'g'.repeat(24),
  roundParticipantId: 'p'.repeat(24),
  expectedChunkCount: 0,
};
const refusedSeal = async (body: object) => {
  const f = localClient(() => Response.json(body, { status: 409 }));
  try {
    return await f.client.seal(sealing).then(
      () => 'sealed',
      (error: unknown) => [
        (error as { code: string }).code,
        isOpenTimelineRefusal(error),
      ],
    );
  } finally {
    await f.close();
  }
};

test('a seal refused for an open timeline is told apart from a definite refusal', async () => {
  assert({
    given: 'a 409 naming the open timeline, and a 409 naming nothing',
    should:
      'report both as conflicts, marking only the first as resendable (VIDEO-4.1-r1)',
    actual: [
      await refusedSeal({
        error: { code: 'CONFLICT' },
        refusal: 'timeline-open',
      }),
      await refusedSeal({ error: { code: 'CONFLICT' } }),
    ],
    expected: [
      ['CONFLICT', true],
      ['CONFLICT', false],
    ],
  });
});

test('retries share one overall deadline per call', async () => {
  let deadlines = 0;
  const f = localClient(
    (call) =>
      call < 3 ? new Response(null, { status: 503 }) : Response.json(lease),
    () => {
      deadlines++;
      return AbortSignal.timeout(2000);
    },
  );
  try {
    await f.client.lease(15000);
    assert({
      given: 'a call answered 503, 503, then a lease',
      should:
        'take a single transport deadline for all three attempts (VIDEO-4.1-r2)',
      actual: [f.calls(), deadlines],
      expected: [3, 1],
    });
  } finally {
    await f.close();
  }
});

test('an elapsed call deadline ends the retries', async () => {
  const deadline = new AbortController();
  const f = localClient(
    () => {
      deadline.abort();
      return new Response(null, { status: 503 });
    },
    () => deadline.signal,
  );
  try {
    await assertRejects({
      given: 'a deadline that elapses with the first 503',
      should: 'stop retrying and report infrastructure unavailability',
      actual: () => f.client.lease(15000),
      code: 'INFRASTRUCTURE',
    });
    assert({
      given: 'the elapsed deadline',
      should: 'leave exactly the one attempt it allowed',
      actual: f.calls(),
      expected: 1,
    });
  } finally {
    await f.close();
  }
});
