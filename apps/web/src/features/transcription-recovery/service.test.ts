import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startTranscriptionRecoveryService } from './service';
import { manualWaits, failureLog } from '../../lib/manual-waits.test-support';
import { claim, limits } from './service.test-support';
setupRitewayBun();
test('renewal is independent of provider work; a blip holds the lease and a stale execution cancels before releasing capacity', async () => {
  const { waits, tasks } = manualWaits(),
    log = failureLog();
  let released = 0,
    calls = 0,
    renewals = 0,
    aborted = false;
  const service = startTranscriptionRecoveryService({
    workerId: 'worker-memory',
    limits,
    waits,
    failed: log.failed,
    store: {
      missing: async () => [],
      claim: async () => claim(),
      renew: async () => {
        renewals++;
        if (renewals === 1) throw new Error('Controlled unknown renewal');
        throw createAppError('CONFLICT', 'Recognition execution is stale');
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
  const abortedByBlip = aborted;
  await tasks.get(3000)!();
  const abortedByRenewal = aborted;
  await service.stop();
  assert({
    given:
      'a blocked provider operation, an unknown renewal failure, then a stale-execution refusal',
    should:
      'renew without waiting for the provider, keep the call through the blip, cancel on the refusal, drain and release the one slot once',
    actual: {
      calls,
      renewals,
      aborted,
      abortedByBlip,
      abortedByRenewal,
      released,
      waits: tasks.size,
      failures: log.failures.length,
    },
    expected: {
      calls: 1,
      renewals: 2,
      aborted: true,
      abortedByBlip: false,
      abortedByRenewal: true,
      released: 1,
      waits: 0,
      failures: 2,
    },
  });
});
test('stop during durable claim waits for its outcome but cannot dispatch the late claim', async () => {
  const { waits } = manualWaits(),
    admitted = Promise.withResolvers<ReturnType<typeof claim>>(),
    entered = Promise.withResolvers<void>();
  let calls = 0,
    released = 0;
  const service = startTranscriptionRecoveryService({
    workerId: 'worker-memory',
    limits,
    waits,
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
