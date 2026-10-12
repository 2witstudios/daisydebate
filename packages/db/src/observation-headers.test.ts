import { assert, setupRitewayBun, test } from 'riteway/bun';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { observationHeaders } from './schema/observation-headers';
import { readObservationHeaders } from './observation-headers';
import { createTestDatabase } from './index.test-support';
import { assertRejects } from '@daisy/errors/testing';
setupRitewayBun();
test('headers own indexed resource metadata and cap requests before SQL', async () => {
  const config = getTableConfig(observationHeaders);
  const database = createTestDatabase([]).database;
  await assertRejects({
    given: '129 requested resource headers',
    should: 'reject before unbounded SQL work',
    actual: () =>
      readObservationHeaders(
        database as never,
        Array.from({ length: 129 }, () => ({
          kind: 'room' as const,
          id: 'a'.repeat(24),
        })),
      ),
    code: 'VALIDATION',
  });
  assert({
    given: 'durable resource header schema',
    should: 'have one composite identity and bigint safe-number revisions',
    actual: {
      keys: config.primaryKeys.length,
      types: [
        observationHeaders.contentRevision.dataType,
        observationHeaders.disclosureRevision.dataType,
        observationHeaders.purgeGeneration.dataType,
      ],
    },
    expected: {
      keys: 1,
      types: ['number int53', 'number int53', 'number int53'],
    },
  });
});
