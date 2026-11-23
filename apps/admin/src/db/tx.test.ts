import { assert, setupRitewayBun, test } from 'riteway/bun';
import { appendAudit } from '../audit/store';
import { adminTransactionLocks, takeLock } from './locks';
import type { AdminTxSource } from './tx';

setupRitewayBun();

test('only an open transaction appends to the audit chain or holds its lock', () => {
  // The pool's autocommit would release the transaction lock after its own
  // statement, so the head read and the insert would race and fork the chain.
  // The type checker is the assertion: each call below must fail to compile,
  // and the admin typecheck fails if either `@ts-expect-error` goes unused.
  const refused = (pool: AdminTxSource) => [
    // @ts-expect-error the pool is not a transaction
    () => appendAudit(pool, undefined as never),
    // @ts-expect-error the pool cannot hold a transaction-scoped lock
    () => takeLock(pool, adminTransactionLocks.auditChain()),
  ];
  assert({
    given: 'the admin pool where a transaction is required',
    should: 'be refused by the type checker, which the admin typecheck runs',
    actual: typeof refused,
    expected: 'function',
  });
});
