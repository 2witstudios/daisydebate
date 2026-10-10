import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { writeAccountBirthMonth, loadAccountAgeSource } from './account-age';
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
describe('birthmonth collection authority', () => {
  test('pending policy refuses before transaction', async () => {
    await assertRejects({
      given: 'pending age collection/legal authority',
      should: 'perform no transaction or write',
      actual: () =>
        writeAccountBirthMonth(
          {
            transaction: () => {
              throw new Error('Transaction must not start');
            },
          } as Parameters<typeof writeAccountBirthMonth>[0],
          {
            userId: 'a'.repeat(24),
            birthMonth: '2010-10',
            now: '2026-10-09T00:00:00.000Z',
            expectedAccountRevision: 1,
            expectedAgeRevision: null,
          },
          { status: 'pending', decision: 'WAIT-4.6' },
        ),
      code: 'AUTHORIZATION',
    });
  });
});
