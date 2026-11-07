import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startTranscriptionRecoveryService } from './service';
import { manualTimers, failureLog } from '../../lib/worker-timers.test-support';
import { claim, limits } from './service.test-support';
setupRitewayBun();
test('missing-source enrollment progresses without provider capacity and after one unit fails', async () => {
  const { timers } = manualTimers(),
    log = failureLog(),
    enrolled: string[] = [];
  let claims = 0;
  const service = startTranscriptionRecoveryService({
    workerId: 'worker-memory',
    limits,
    timers,
    failed: log.failed,
    store: {
      missing: async () => [
        { roundId: 'r', evidenceId: 'one' },
        { roundId: 'r', evidenceId: 'two' },
      ],
      claim: async () => {
        claims++;
        return claim();
      },
      renew: async () => ({
        kind: 'renewed' as const,
        expiresAt: claim().expiresAt,
      }),
    },
    enroll: async (target) => {
      enrolled.push(target.evidenceId);
      if (target.evidenceId === 'one')
        throw new Error('Controlled unavailable original');
    },
    reserveCapacity: () => null,
    execute: async () => {},
  });
  try {
    await service.started;
    assert({
      given: 'no paid capacity and an unavailable first original',
      should:
        'visit the later original without claiming paid work or suppressing failure',
      actual: { enrolled, claims, failures: log.failures.length },
      expected: { enrolled: ['one', 'two'], claims: 0, failures: 1 },
    });
  } finally {
    await service.stop();
  }
});
test('a capacity subsystem failure is reported without leaving a rejected timer task', async () => {
  const { timers } = manualTimers(),
    log = failureLog();
  let claims = 0;
  const service = startTranscriptionRecoveryService({
    workerId: 'worker-memory',
    limits,
    timers,
    failed: log.failed,
    store: {
      missing: async () => [],
      claim: async () => {
        claims++;
        return claim();
      },
      renew: async () => ({
        kind: 'renewed' as const,
        expiresAt: claim().expiresAt,
      }),
    },
    enroll: async () => {},
    reserveCapacity: () => {
      throw new Error('Controlled capacity outage');
    },
    execute: async () => {},
  });
  let rejected = false;
  try {
    await service.started;
  } catch {
    rejected = true;
  }
  await service.stop();
  assert({
    given: 'capacity reservation throws before any durable claim',
    should:
      'report a retryable scan fault without a claim or unhandled worker rejection',
    actual: { claims, rejected, failures: log.failures.length },
    expected: { claims: 0, rejected: false, failures: 1 },
  });
});
