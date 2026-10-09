import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  erasePrivacySubject,
  type PrivacyVerificationBinding,
} from './operations';

setupRitewayBun();
test('verification cleanup rejects noncanonical bindings before any transaction', async () => {
  let transactions = 0;
  const database = {
    transaction: async () => {
      transactions++;
      throw new Error('transaction must not run');
    },
  } as unknown as Pick<BunSQLDatabase, 'transaction'>;
  const bad: readonly (readonly PrivacyVerificationBinding[])[] = [
    [{ purpose: ' sign-in ', subject: 'email' }],
    [{ jsonTypes: [' registration '], subjectPath: ['userData', 'id'] }],
    [{ jsonTypes: ['registration'], subjectPath: [' userData ', 'id'] }],
    [
      { purpose: 'sign-in', subject: 'email' },
      { purpose: ' sign-in ', subject: 'email' },
    ],
    [],
  ];
  for (const binding of bad)
    await assertRejects({
      given:
        'noncanonical whitespace or missing verification producer bindings',
      should: 'refuse cleanup instead of leaving pending subject tokens alive',
      actual: () =>
        erasePrivacySubject(
          database,
          {
            subject: {
              userId: 'abcdefghijklmnopqrstuvwx',
              actorId: 'bcdefghijklmnopqrstuvwxy',
            },
            now: '2026-10-09T18:00:00.000Z',
            vendors: [],
            jobIds: [],
          },
          { requiredAdopters: [], adopters: [] },
          binding,
        ),
      code: 'VALIDATION',
    });
  assert({
    given: 'all rejected verification binding manifests',
    should: 'perform no database operation',
    actual: transactions,
    expected: 0,
  });
});
