import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { retryStale } from './retry-stale';

setupRitewayBun();

const exhausted = () => createAppError('CONFLICT', 'version-conflict');

test('stale work retries from fresh facts, then refuses', async () => {
  const stale = new Error('stale');
  let calls = 0;
  const recovered = await retryStale(
    async () => {
      calls += 1;
      if (calls < 3) throw stale;
      return 'rated';
    },
    (error) => error === stale,
    3,
    exhausted,
  );
  let spent = 0;
  await assertRejects({
    given: 'work that stays stale for every attempt',
    should: 'refuse as the exhausted conflict after the last attempt',
    actual: () =>
      retryStale(
        async () => {
          spent += 1;
          throw stale;
        },
        (error) => error === stale,
        3,
        exhausted,
      ),
    code: 'CONFLICT',
  });
  let other = 0;
  await assertRejects({
    given: 'a failure that is not stale',
    should: 'rethrow it without retrying',
    actual: () =>
      retryStale(
        async () => {
          other += 1;
          throw createAppError('NOT_FOUND', 'No such round');
        },
        (error) => error === stale,
        3,
        exhausted,
      ),
    code: 'NOT_FOUND',
  });
  assert({
    given: 'two stale attempts before success, three stale, and one other',
    should: 'attempt exactly as often as the retry rule allows',
    actual: { recovered, calls, spent, other },
    expected: { recovered: 'rated', calls: 3, spent: 3, other: 1 },
  });
});
