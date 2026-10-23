import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { decideStartHorizon } from './round-start-horizon';
import { roundAt, runtimeWorld } from './runtime.test-support';

setupRitewayBun();

const horizon = { launchedAtMs: 1_000, horizonMs: 900_000 };

test('a scheduled Round is abandoned once its start horizon passes (DEC-214)', () => {
  assert({
    given:
      'a scheduled Round just before, exactly at and after Launch plus its horizon',
    should: 'keep it until the horizon, then abandon it',
    actual: [900_999, 901_000, 2_000_000].map((nowMs) =>
      decideStartHorizon({ ...horizon, status: 'scheduled', nowMs }),
    ),
    expected: ['keep', 'abandon', 'abandon'],
  });
});

test('only a scheduled Round is ever abandoned by its start horizon', () => {
  assert({
    given: 'active, completed and abandoned Rounds long past the horizon',
    should: 'keep each, since starting or ending already decided it',
    actual: (['active', 'completed', 'abandoned'] as const).map((status) =>
      decideStartHorizon({ ...horizon, status, nowMs: 5_000_000 }),
    ),
    expected: ['keep', 'keep', 'keep'],
  });
});

test('the start horizon is an explicit positive whole-millisecond policy', async () => {
  for (const horizonMs of [0, -1, 1.5, Number.NaN])
    await assertRejects({
      given: `a start horizon of ${horizonMs} ms`,
      should: 'refuse the policy as an invariant',
      actual: async () =>
        decideStartHorizon({
          launchedAtMs: 1_000,
          horizonMs,
          status: 'scheduled',
          nowMs: 2_000_000,
        }),
      code: 'INVARIANT',
    });
});

test('abandoning an unstarted Round ends it with no outcome, start or segment', async () => {
  const projection = runtimeWorld().abandonUnstarted(roundAt(900_000));
  assert({
    given: 'a scheduled Round nobody started, abandoned at its horizon',
    should:
      'project it abandoned at that instant with no outcome, start time or segment',
    actual: {
      status: projection.round?.status,
      outcome: projection.round?.outcome,
      startedAt: projection.round?.startedAt,
      completedAt: projection.round?.completedAt,
      inserts: projection.segmentInserts.length,
    },
    expected: {
      status: 'abandoned',
      outcome: null,
      startedAt: null,
      completedAt: roundAt(900_000),
      inserts: 0,
    },
  });
  await assertRejects({
    given: 'a Round that already started',
    should: 'refuse to abandon it by start horizon',
    actual: async () =>
      runtimeWorld({ status: 'active' }).abandonUnstarted(roundAt(900_000)),
    code: 'CONFLICT',
  });
});
