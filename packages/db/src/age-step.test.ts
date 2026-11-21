import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ageStepOperations } from './age-step';
import type { TxOpener } from './tx';

setupRitewayBun();

test('a malformed age-step answer is refused before any query', async () => {
  let transactions = 0;
  const opener: TxOpener = {
    async transaction() {
      transactions++;
      throw new Error('The invalid age step reached persistence');
    },
  };
  const database = ageStepOperations({
    database: opener,
    eventSink: undefined,
  });
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
      transactions,
    ],
    expected: ['VALIDATION', 'VALIDATION', 'VALIDATION', 0],
  });
});
