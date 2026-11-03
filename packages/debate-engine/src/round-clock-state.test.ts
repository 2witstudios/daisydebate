import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { abandonedLifecycle, type Lifecycle } from './round-clock-state';

setupRitewayBun();

const ended: readonly Lifecycle[] = [
  { status: 'completed', startedAtMs: 1, completedAtMs: 2, outcome: null },
  { status: 'abandoned', startedAtMs: 1, completedAtMs: 2 },
];

test('only a running Round is abandoned', async () => {
  for (const lifecycle of ended) {
    const before = structuredClone(lifecycle);
    await assertRejects({
      given: `a ${lifecycle.status} lifecycle`,
      should: 'refuse the ending',
      actual: async () => abandonedLifecycle(lifecycle, 3),
      code: 'INVARIANT',
      invariantId: 'round.lifecycle.matches-status',
    });
    assert({
      given: `a refused abandonment of a ${lifecycle.status} lifecycle`,
      should: 'leave it unchanged',
      actual: lifecycle,
      expected: before,
    });
  }
  assert({
    given: 'an active and an opening lifecycle',
    should: 'abandon each, keeping the start only where there was one',
    actual: [
      abandonedLifecycle({ status: 'active', startedAtMs: 1 }, 3),
      abandonedLifecycle({ status: 'opening' }, 3),
    ],
    expected: [
      { status: 'abandoned', startedAtMs: 1, completedAtMs: 3 },
      { status: 'abandoned', startedAtMs: null, completedAtMs: 3 },
    ],
  });
});
