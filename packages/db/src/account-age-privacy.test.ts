import { assert, setupRitewayBun, test } from 'riteway/bun';
import { accountAgePrivacyAdopter } from './account-age';
import { scriptedTransaction } from './scripted-transaction.test-support';

setupRitewayBun();
const input = {
  userId: 'u'.repeat(24),
  birthMonth: '2000-01',
  now: '2026-10-09T00:00:00.000Z',
};
const ageDatabase = (responses: unknown[][]) =>
  scriptedTransaction(responses, () => {
    throw new Error('Unexpected age query');
  });

test('age adopter binds own export/delete under the approved age-step policy', async () => {
  const subject = { userId: input.userId, actorId: 'a'.repeat(24) };
  const fixture = ageDatabase([
    [],
    [
      {
        birthMonth: input.birthMonth,
        revision: 2,
        recordedAt: new Date(input.now),
      },
    ],
    [],
  ]);
  const empty = await accountAgePrivacyAdopter.export(fixture.tx, subject);
  const present = await accountAgePrivacyAdopter.export(fixture.tx, subject);
  await accountAgePrivacyAdopter.erase(fixture.tx, subject, { now: input.now });
  assert({
    given: 'an absent then present own age source',
    should: 'export only the bound source and delete only its user association',
    actual: [empty, present, fixture.queries.map(({ params }) => params[0])],
    expected: [
      { account_age: [] },
      {
        account_age: [
          {
            user_id: input.userId,
            birth_month: input.birthMonth,
            version: 2,
            recorded_at: input.now,
          },
        ],
      },
      [input.userId, input.userId, input.userId],
    ],
  });
  assert({
    given: 'the owner’s age-step decision (DEC-244)',
    should:
      'classify the birth month under legal obligation and contract, kept for the life of the account',
    actual: accountAgePrivacyAdopter.fields.map(
      ({ lawfulBasis, retention }) => [lawfulBasis, retention],
    ),
    expected: Array.from({ length: 4 }, () => [
      {
        status: 'approved' as const,
        decision: 'cnl34yx54fgtuxwvekobc657',
        rule: 'legal obligation and contract',
      },
      {
        status: 'approved' as const,
        decision: 'cnl34yx54fgtuxwvekobc657',
        rule: 'life of the account',
      },
    ]),
  });
});
