import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { createRatingSweep } from './sweep';

setupRitewayBun();

test('rating recovery advances past failures and retries them on the next bounded scan', async () => {
  const attempts: string[] = [];
  const failures: string[] = [];
  const sweep = createRatingSweep({
    ids: { next: () => 'ledger-id' },
    database: {
      readUnratedRatingRounds: async () => ['blocked', 'ready'],
      rateRound: async ({ roundId }) => {
        attempts.push(roundId);
        if (roundId === 'blocked')
          throw createAppError('CONFLICT', 'No season is active');
        return { kind: 'already-rated' };
      },
    },
    onFailure: (roundId, _error) => {
      failures.push(roundId);
    },
  });
  const page = await sweep({ limit: 2 });
  await sweep({ limit: 2 });
  assert({
    given:
      'one failed posting before an eligible result in a full recovery page',
    should:
      'attempt later results, retain scan progress and retry failures next pass',
    actual: { attempts, failures, page },
    expected: {
      attempts: ['blocked', 'ready', 'blocked', 'ready'],
      failures: ['blocked', 'blocked'],
      page: { afterId: 'ready', exhausted: false },
    },
  });
});
