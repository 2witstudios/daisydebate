import { getTableColumns, getTableName } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { accountTermsPrivacyAdopter } from './age-step';
import { validatePrivacyAdoption } from './privacy/declarations';
import { accountTerms } from './schema/account-terms';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

test('the Terms acceptance declares exactly its columns under DEC-244', () => {
  assert({
    given: 'the account_terms schema and its privacy declarations',
    should: 'match every column with approved, activatable policies',
    actual: validatePrivacyAdoption(
      {
        [getTableName(accountTerms)]: Object.values(
          getTableColumns(accountTerms),
        ).map((column) => column.name),
      },
      accountTermsPrivacyAdopter.fields,
    ),
    expected: { problems: [], activationHeld: false },
  });
});

test('a malformed age-step answer is refused before any query', async () => {
  const { database, queries } = createTestDatabase([]);
  const refused = (input: Parameters<typeof database.recordAgeStep>[0]) =>
    database.recordAgeStep(input).then(
      () => null,
      (error: { code?: string }) => error.code,
    );
  const valid = {
    userId: 'u'.repeat(24),
    birthMonth: '2000-01',
    termsVersion: 'draft-0',
    now: '2026-10-26T00:00:00.000Z',
  };
  assert({
    given: 'a bad birth month, an empty Terms version and a non-UTC time',
    should: 'refuse each as VALIDATION with nothing sent to the database',
    actual: [
      await refused({ ...valid, birthMonth: '2000-13' }),
      await refused({ ...valid, termsVersion: '' }),
      await refused({ ...valid, now: '2026-10-26' }),
      queries.length,
    ],
    expected: ['VALIDATION', 'VALIDATION', 'VALIDATION', 0],
  });
});
