import type { SQL } from 'bun';
import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createBoundedTransaction,
  isTransactionCapacityRefusal,
} from './bounded-transaction';
setupRitewayBun();

test('an admission refusal is recognisable as backpressure', async () => {
  const run = createBoundedTransaction({
    client: {} as SQL,
    maxConnections: 1,
    now: () => 0,
  });
  let refusal: unknown = null;
  try {
    await run(async () => undefined);
  } catch (error) {
    refusal = error;
  }
  assert({
    given: 'a pool with no admissible writer reservation',
    should:
      'refuse with an identifiable capacity error, distinct from any lookalike',
    actual: [
      isTransactionCapacityRefusal(refusal),
      isTransactionCapacityRefusal(
        createAppError(
          'INFRASTRUCTURE',
          'Transcript transaction capacity unavailable',
        ),
      ),
      isTransactionCapacityRefusal(new Error('other')),
    ],
    expected: [true, false, false],
  });
});
