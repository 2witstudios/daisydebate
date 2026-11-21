import { assertRejects } from '@daisy/errors/testing';
import { setupRitewayBun, test } from 'riteway/bun';
import { createRoundAnalysisJobs } from './round-analysis-jobs';
import type { BoundedTransaction } from './bounded-transaction';
setupRitewayBun();

const refuseDatabaseAccess: BoundedTransaction = async () => {
  throw new Error('Validation must precede database access');
};

test('analysis worker bounds refuse invalid configuration before touching a resource', async () => {
  for (const [leaseMs, model] of [
    [0, 'model'],
    [180001, 'model'],
    [30000, ' '],
  ] as const) {
    await assertRejects({
      given: `lease ${leaseMs} and model ${JSON.stringify(model)}`,
      should: 'refuse an unusable worker configuration',
      code: 'VALIDATION',
      actual: async () =>
        createRoundAnalysisJobs({
          run: refuseDatabaseAccess,
          nextToken: () => 't'.repeat(43),
          nextId: () => 'i'.repeat(24),
          leaseMs,
          model,
          accountEligible: () => true,
        }),
    });
  }
});

test('requested analysis discovery has a finite page bound', async () => {
  const jobs = createRoundAnalysisJobs({
    run: refuseDatabaseAccess,
    nextToken: () => 't'.repeat(43),
    nextId: () => 'i'.repeat(24),
    leaseMs: 30000,
    model: 'model',
    accountEligible: () => true,
  });
  for (const limit of [0, 65, 1.5, NaN])
    await assertRejects({
      given: `scan bound ${limit}`,
      should: 'refuse before any query',
      code: 'VALIDATION',
      actual: async () => jobs.scan(limit),
    });
});
