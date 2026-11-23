import { assert, setupRitewayBun, test } from 'riteway/bun';
import { appendAudit } from '../audit/store';
import { adminTransactionLocks, takeLock } from './locks';
import type { AdminTxSource } from './tx';

setupRitewayBun();

test('only an open transaction appends to the audit chain or holds its lock', () => {
  // The pool's autocommit would release the transaction lock after its own
  // statement, so the head read and the insert would race and fork the chain.
  const refused = (pool: AdminTxSource) => [
    // @ts-expect-error the pool is not a transaction
    () => appendAudit(pool, undefined as never),
    // @ts-expect-error the pool cannot hold a transaction-scoped lock
    () => takeLock(pool, adminTransactionLocks.auditChain()),
  ];
  assert({
    given: 'the admin pool where a transaction is required',
    should: 'not compile (the calls above carry the expected errors)',
    actual: refused.length,
    expected: 1,
  });
});
