import { assert, setupRitewayBun, test } from 'riteway/bun';
import { initialManagerState, reduceManager } from './document-manager-state';
import type { MemberDocument } from './document';

setupRitewayBun();
const document: MemberDocument = {
  id: 'd'.repeat(24),
  title: 'Notes',
  html: '<p>saved</p>',
  createdAt: '2026-10-09T00:00:00.000Z',
  updatedAt: '2026-10-09T00:00:00.000Z',
};
test('persisted workspace loads actual documents and keeps valid active tabs', () => {
  const loaded = reduceManager(initialManagerState(), {
    type: 'doc/loaded',
    documents: [document],
  });
  const next = reduceManager(loaded, {
    type: 'doc/loaded',
    documents: [{ ...document, html: '<p>latest</p>' }],
  });
  assert({
    given: 'a saved private document and a fresh server reread',
    should: 'open actual identity and adopt stored content',
    actual: [next.tabs.active, next.documents[0]?.html],
    expected: [document.id, '<p>latest</p>'],
  });
});
