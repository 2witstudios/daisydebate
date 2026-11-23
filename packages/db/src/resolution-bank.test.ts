import { assert, setupRitewayBun, test } from 'riteway/bun';
import { resolutionBankRevision1 } from './resolution-bank';

setupRitewayBun();

test('revision 1 of the curated bank is balanced', () => {
  const entries = resolutionBankRevision1.entries.map((entry) => ({
    ...entry,
    revision: resolutionBankRevision1.revision,
  }));
  assert({
    given: 'revision 1',
    should: 'balance policy, value and fact with no duplicate text',
    actual: [
      ['policy', 'value', 'fact'].map(
        (category) =>
          entries.filter((entry) => entry.category === category).length,
      ),
      new Set(entries.map((entry) => entry.text.toLowerCase())).size,
    ],
    expected: [[14, 14, 14], entries.length],
  });
});
