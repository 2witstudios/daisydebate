import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { maintainCaptureLease } from './capture-lease';
setupRitewayBun();

test('capture renewal is independent of blocked history or native work', async () => {
  const stop = new AbortController();
  const due = Promise.withResolvers<void>();
  const renewed = Promise.withResolvers<void>();
  let now = 0,
    calls = 0;
  let requestedEpoch: number | undefined;
  const running = maintainCaptureLease({
    epoch: 1,
    signal: stop.signal,
    nowMs: () => now,
    waitUntilMs: async (_until, signal) => {
      if (calls === 0) await due.promise;
      else
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        );
    },
    lease: async (_ms, _signal, expectedEpoch) => {
      requestedEpoch = expectedEpoch;
      calls++;
      renewed.resolve();
      return { epoch: 1, expiresAt: new Date(20000).toISOString() };
    },
  });
  now = 5000;
  due.resolve();
  await renewed.promise;
  stop.abort();
  await running;
  assert({
    given: 'the capture history or native loop has not advanced',
    should: 'still renew its lease on the independent heartbeat',
    actual: [calls, requestedEpoch],
    expected: [1, 1],
  });
});

test('capture renewal never adopts a replacement epoch', async () => {
  await assertRejects({
    given: 'another worker owns the renewed lease epoch',
    should: 'stop the old capture authority with a conflict',
    actual: () =>
      maintainCaptureLease({
        epoch: 1,
        signal: new AbortController().signal,
        nowMs: () => 0,
        waitUntilMs: async () => {},
        lease: async () => ({
          epoch: 2,
          expiresAt: new Date(15000).toISOString(),
        }),
      }),
    code: 'CONFLICT',
  });
});
