import { describe, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { writeAccountBirthMonth } from './account-age';
setupRitewayBun();
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
