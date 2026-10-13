import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { workloadCapacities, workloadQueueOptions } from './workload-admission';

setupRitewayBun();

test('runtime lanes queue with the plan bounds for their workload', () => {
  const capacities = workloadCapacities('web', 12);
  assert({
    given: 'the web profile on a 12-connection pool',
    should:
      'reserve every lane, bound interactive waits tightly and give the control lane a deep bounded queue',
    actual: { capacities, queues: workloadQueueOptions(capacities).queues },
    expected: {
      capacities: { control: 4, competitive: 4, social: 3, search: 1 },
      queues: {
        control: { depth: 2_048, maxWaitMs: 5_000 },
        competitive: { depth: 16, maxWaitMs: 50 },
        social: { depth: 16, maxWaitMs: 100 },
        search: { depth: 16, maxWaitMs: 100 },
      },
    },
  });
});

test('small pools give every lane a slot and refuse pools that cannot', async () => {
  assert({
    given: 'web pools of exactly the lane count and larger than the ceilings',
    should:
      'give each lane one slot first and the unreserved remainder to control',
    actual: [workloadCapacities('web', 4), workloadCapacities('web', 20)],
    expected: [
      { control: 1, competitive: 1, social: 1, search: 1 },
      { control: 12, competitive: 4, social: 3, search: 1 },
    ],
  });
  await assertRejects({
    given: 'a web pool smaller than its four lanes',
    should: 'refuse the configuration rather than leave a lane unable to run',
    actual: async () => workloadCapacities('web', 3),
    code: 'VALIDATION',
  });
});

test('every profile spends its whole pool on lanes it actually has', () => {
  const profiles = ['web', 'realtime', 'reconciliation', 'projection'] as const;
  const totals = profiles.map((profile) => {
    const capacities = workloadCapacities(profile, 20);
    return {
      profile,
      lanes: Object.values(capacities).every(
        (slots) => Number.isSafeInteger(slots) && slots! >= 1,
      ),
      total: Object.values(capacities).reduce((sum, n) => sum + n!, 0),
    };
  });
  assert({
    given: 'every profile on a 20-connection pool',
    should: 'give each of its lanes a whole positive count summing to the pool',
    actual: totals,
    expected: profiles.map((profile) => ({ profile, lanes: true, total: 20 })),
  });
  assert({
    given: 'the projection profile, which has no control lane',
    should: 'give unreserved connections to its first lane',
    actual: workloadCapacities('projection', 6),
    expected: { projection: 4, headers: 1, relay: 1 },
  });
});
