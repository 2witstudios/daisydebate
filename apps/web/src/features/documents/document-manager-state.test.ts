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

test('a document opened before the load answers keeps its tab', () => {
  const clicked = { ...document, id: 'c'.repeat(24), title: 'Clicked' };
  const opened = reduceManager(initialManagerState(), {
    type: 'doc/add',
    document: clicked,
  });
  const loaded = reduceManager(opened, {
    type: 'doc/loaded',
    documents: [document],
  });
  assert({
    given: 'a click that beat the load',
    should: 'keep the clicked document open and active',
    actual: [loaded.tabs.active, loaded.documents.length],
    expected: [clicked.id, 2],
  });
  const withdrawn = reduceManager(loaded, { type: 'doc/withdrawn' });
  assert({
    given: 'the owner closing',
    should: 'leave nothing on screen',
    actual: withdrawn.documents.length,
    expected: 0,
  });
});
