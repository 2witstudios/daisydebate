import { assert, setupRitewayBun, test } from 'riteway/bun';
import { documentSaveOutcome } from './document-operations';

setupRitewayBun();

test('a failed compare-and-swap reports conflict for a present document, else missing', () => {
  assert({
    given: 'a swapped row, an unswapped present row and an absent row',
    should: 'report saved, conflict with the current revision, and missing',
    actual: [
      documentSaveOutcome([{ revision: 4 }], undefined),
      documentSaveOutcome([], { revision: 6 }),
      documentSaveOutcome([], undefined),
    ],
    expected: [
      { status: 'saved', revision: 4 },
      { status: 'conflict', revision: 6 },
      { status: 'missing' },
    ],
  });
});
