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
        control: { depth: 256, maxWaitMs: 2_000 },
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
