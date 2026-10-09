import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  lockAuthorizationActors,
  type AuthorizationTransaction,
} from './authorization';
setupRitewayBun();
describe('account lock boundary', () => {
  test('invalid actor batches never reach the transaction', async () => {
    let calls = 0;
    const tx = {
      execute: async () => {
        calls += 1;
        return [];
      },
    } as unknown as AuthorizationTransaction;
    for (const ids of [
      [],
      ['invalid'],
      ['a'.repeat(24), 'a'.repeat(24)],
      Array.from({ length: 51 }, (_, n) => String(n).padStart(24, 'a')),
    ]) {
      await assertRejects({
        given: 'malformed, repeated, empty or excessive actor ids',
        should: 'reject before I/O',
        actual: () => lockAuthorizationActors(tx, ids, { maxActors: 50 }),
        code: 'VALIDATION',
      });
    }
    assert({
      given: 'rejected batches',
      should: 'leave transaction untouched',
      actual: calls,
      expected: 0,
    });
  });
});
