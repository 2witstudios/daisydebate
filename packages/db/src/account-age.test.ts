import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { loadAccountAgeSource } from './account-age';
import type { AuthorizationTransaction } from './authorization';
setupRitewayBun();
test('nonfinite persisted source recording time fails closed', async () => {
  const tx = {
    execute: async () => [
      { birthMonth: '2000-01', revision: 1, recordedAt: new Date(NaN) },
    ],
  } as unknown as AuthorizationTransaction;
  assert({
    given: 'a nonfinite persisted timestamp',
    should: 'return no usable source without a raw date exception',
    actual: await loadAccountAgeSource(tx, 'a'.repeat(24)),
    expected: null,
  });
});
test('invalid source identity refuses before database access', async () => {
  await assertRejects({
    given: 'an invalid source user identifier',
    should: 'refuse before querying personal data',
    actual: () =>
      loadAccountAgeSource(
        {
          execute: async () => {
            throw new Error('Age source query must not start');
          },
        } as unknown as AuthorizationTransaction,
        'invalid',
      ),
    code: 'VALIDATION',
  });
});
