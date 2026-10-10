import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  initialPersistedWorkspace,
  reducePersistedWorkspace,
} from './persisted-workspace';
import type { WorkspaceDocument } from '../../features/debate-room/documents/documents';

setupRitewayBun();
const document: WorkspaceDocument = {
  id: 'd'.repeat(24),
  title: 'Flow',
  folder: 'round',
  templateId: 'flow',
  html: '<p>saved</p>',
  createdAt: '2026-10-09T00:00:00.000Z',
  updatedAt: '2026-10-09T00:00:00.000Z',
};
test('persisted workspace loads actual documents and keeps valid active tabs', () => {
  const loaded = reducePersistedWorkspace(initialPersistedWorkspace, {
    type: 'doc/loaded',
    documents: [document],
  });
  const next = reducePersistedWorkspace(loaded, {
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
test('scheduled workspace ignores competitive floor and fabricated chat actions', () => {
  const unchanged = reducePersistedWorkspace(initialPersistedWorkspace, {
    type: 'end/press',
  });
  assert({
    given: 'a scheduled document workspace',
    should:
      'keep document state unchanged for an unsupported live-round action',
    actual: unchanged === initialPersistedWorkspace,
    expected: true,
  });
});
