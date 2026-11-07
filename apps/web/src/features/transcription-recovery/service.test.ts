import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startTranscriptionRecoveryService } from './service';
import { manualTimers, failureLog } from '../../lib/worker-timers.test-support';
import { claim, limits } from './service.test-support';
setupRitewayBun();
test('renewal is independent of provider work and uncertainty cancels before releasing capacity', async () => {
  const { timers, tasks } = manualTimers(),
    log = failureLog();
  let released = 0,
    calls = 0,
    renewals = 0,
    aborted = false;
  const service = startTranscriptionRecoveryService({
    workerId: 'worker-memory',
    limits,
    timers,
    failed: log.failed,
    store: {
      missing: async () => [],
      claim: async () => claim(),
      renew: async () => {
        renewals++;
        throw new Error('Controlled unknown renewal');
      },
    },
    enroll: async () => {},
    reserveCapacity: () => () => {
      released++;
    },
    execute: async (_claim, signal) => {
      calls++;
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            resolve();
          },
          { once: true },
        ),
      );
    },
  });
  await service.started;
  await tasks.get(1000)!();
  await tasks.get(3000)!();
  const abortedByRenewal = aborted;
  await service.stop();
  assert({
    given: 'a blocked provider operation and unknown renewal',
    should:
      'renew without waiting for the provider, cancel, drain and release the one slot once',
    actual: {
      calls,
      renewals,
      aborted,
      abortedByRenewal,
      released,
      timers: tasks.size,
      failures: log.failures.length,
    },
    expected: {
      calls: 1,
      renewals: 1,
      aborted: true,
      abortedByRenewal: true,
      released: 1,
      timers: 0,
      failures: 1,
    },
  });
});
test('stop during durable claim waits for its outcome but cannot dispatch the late claim', async () => {
  const { timers } = manualTimers(),
    admitted = Promise.withResolvers<ReturnType<typeof claim>>(),
    entered = Promise.withResolvers<void>();
  let calls = 0,
    released = 0;
  const service = startTranscriptionRecoveryService({
    workerId: 'worker-memory',
    limits,
    timers,
    failed: () => {},
    store: {
      missing: async () => [],
      claim: async () => {
        entered.resolve();
        return admitted.promise;
      },
      renew: async () => ({
        kind: 'renewed' as const,
        expiresAt: claim().expiresAt,
      }),
    },
    enroll: async () => {},
    reserveCapacity: () => () => {
      released++;
    },
    execute: async () => {
      calls++;
    },
  });
  await entered.promise;
  const stopping = service.stop();
  admitted.resolve(claim());
  await stopping;
  await service.started;
  assert({
    given: 'stop before a successful claim acknowledgement',
    should:
      'leave durable lease recovery to expiry and release capacity without dispatch',
    actual: { calls, released },
    expected: { calls: 0, released: 1 },
  });
});
