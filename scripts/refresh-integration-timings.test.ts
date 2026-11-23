import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  medianDurations,
  suiteDurationsFromLog,
} from './refresh-integration-timings';

setupRitewayBun();

describe('refreshing integration timings from CI logs', () => {
  test('sums passing test time per suite under the workspace that ran it', () => {
    const log = [
      '2026-11-23T13:06:17.1Z test-integration: apps/media-worker shard 1/4: 1/1 suites',
      '2026-11-23T13:06:17.2Z ##[group]integration/encode.integration.ts:',
      '2026-11-23T13:06:17.3Z (pass) encodes a clip [1200.50ms]',
      '2026-11-23T13:06:17.4Z (pass) refuses an empty clip [0.25ms]',
      '2026-11-23T13:06:17.5Z ##[endgroup]',
      '2026-11-23T13:06:17.6Z test-integration: apps/media-worker shard 1/4: 1 suites, 3000 ms, exit 0',
      '2026-11-23T13:06:18.0Z test-integration: packages/db shard 1/4: 2/9 suites',
      '2026-11-23T13:06:18.1Z ##[group]integration/a.integration.ts:',
      '2026-11-23T13:06:18.2Z (pass) a > writes [10.00ms]',
      '2026-11-23T13:06:18.3Z (pass) a > reads [5.00ms]',
      '2026-11-23T13:06:18.4Z ##[group]integration/nested/b.integration.tsx:',
      '2026-11-23T13:06:18.5Z (skip) b > not yet',
    ].join('\n');
    assert({
      given: 'a shard log covering two workspaces',
      should: 'credit each suite its own passing test time by repository path',
      actual: suiteDurationsFromLog(log),
      expected: {
        'apps/media-worker/integration/encode.integration.ts': 1200.75,
        'packages/db/integration/a.integration.ts': 15,
        'packages/db/integration/nested/b.integration.tsx': 0,
      },
    });
  });

  test('takes the median of each suite across runs', () => {
    assert({
      given: 'odd, even and zero-time samples in unsorted order',
      should:
        'record whole-millisecond medians of at least one, sorted by path',
      actual: Object.entries(
        medianDurations({
          'z.integration.ts': [9000, 1000, 4000],
          'a.integration.ts': [10, 21.4],
          'm.integration.ts': [0],
        }),
      ),
      expected: [
        ['a.integration.ts', 16],
        ['m.integration.ts', 1],
        ['z.integration.ts', 4000],
      ],
    });
  });
});
