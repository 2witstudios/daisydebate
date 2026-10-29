import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { verifyIntegrationReceipts } from './integration-receipts';

setupRitewayBun();

describe('integration completion evidence', () => {
  const inventory = {
    'apps/web': [
      'integration/a.integration.ts',
      'integration/new.integration.ts',
    ],
  };
  const complete = () =>
    Array.from({ length: 4 }, (_, index) => ({
      workspace: 'apps/web',
      shard: `${index + 1}/4`,
      files: index < 2 ? [inventory['apps/web'][index]] : [],
      elapsedMs: 1,
    }));

  test('requires all four receipts even when two workers have no suites', () => {
    assert({
      given: 'two executed suites and two explicit empty workspace partitions',
      should: 'accept complete nonoverlapping evidence',
      actual: verifyIntegrationReceipts(inventory, complete(), 4),
      expected: [],
    });
  });

  test('refuses missing, duplicate, overlapping, malformed and incomplete evidence', () => {
    const cases: unknown[][] = [
      complete().slice(0, 3),
      [...complete(), complete()[0]],
      complete().map((receipt, i) =>
        i === 1 ? { ...receipt, files: [inventory['apps/web'][0]] } : receipt,
      ),
      complete().map((receipt, i) =>
        i === 1 ? { ...receipt, files: [] } : receipt,
      ),
      complete().map((receipt, i) =>
        i === 0 ? { ...receipt, files: ['unknown'] } : receipt,
      ),
      complete().map((receipt, i) =>
        i === 0 ? { ...receipt, shard: '5/4' } : receipt,
      ),
      complete().map((receipt, i) =>
        i === 0 ? { ...receipt, elapsedMs: -1 } : receipt,
      ),
      [...complete(), null],
      [],
    ];
    assert({
      given:
        'incomplete or malformed receipts, including a missing empty partition',
      should:
        'refuse every candidate instead of accepting a green partial matrix',
      actual: cases.map(
        (receipts) =>
          verifyIntegrationReceipts(inventory, receipts, 4).length > 0,
      ),
      expected: cases.map(() => true),
    });
  });

  test('refuses an empty discovered workspace and an invalid worker count', () => {
    assert({
      given: 'no discovered suites or an invalid worker count',
      should: 'fail closed',
      actual: [
        verifyIntegrationReceipts({}, [], 4).length > 0,
        verifyIntegrationReceipts(
          { 'apps/web': [] },
          complete().map((receipt) => ({ ...receipt, files: [] })),
          4,
        ).length > 0,
        verifyIntegrationReceipts(inventory, complete(), 0).length > 0,
      ],
      expected: [true, true, true],
    });
  });
});
