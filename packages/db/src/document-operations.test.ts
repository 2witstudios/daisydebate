import { assert, setupRitewayBun, test } from 'riteway/bun';
import { documentSaveOutcome, workspaceDocuments } from './document-operations';

setupRitewayBun();

const at = new Date('2026-10-22T12:00:00.000Z');
const doc = (id: string, title: string, revision = 1) => ({
  id,
  ownerActorId: 'owner',
  title,
  html: `<p>${id}</p>`,
  templateId: 'blank',
  folder: 'library',
  revision,
  createdAt: at,
  updatedAt: at,
});

test('a workspace lists each owned or referenced document once, by title', () => {
  assert({
    given: 'library documents and a referenced document that is also owned',
    should: 'dedupe by id, keep the referenced row and order by title',
    actual: workspaceDocuments(
      [doc('b', 'Rebuttal'), doc('a', 'Case'), doc('c', 'Case')],
      [doc('b', 'Rebuttal', 2)],
    ).map(({ id, revision }) => [id, revision]),
    expected: [
      ['a', 1],
      ['c', 1],
      ['b', 2],
    ],
  });
});

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
