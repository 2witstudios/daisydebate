import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createDocumentSync, type DocumentsApi } from './document-sync';
import {
  manualTimers,
  memoryStorage,
  stored,
} from './document-sync.test-support';

setupRitewayBun();

const savingApi = (
  documents: readonly { readonly id: string; readonly revision: number }[],
) => {
  let state = documents.map((one) => ({ ...stored(one.id, one.revision) }));
  const saves: { id: string; html: string; expectedRevision: number }[] = [];
  const api: DocumentsApi = {
    list: async () => state,
    create: async () => stored('new'),
    save: async ({ id, html, expectedRevision }) => {
      saves.push({ id, html, expectedRevision });
      const doc = state.find((one) => one.id === id);
      if (!doc || doc.revision !== expectedRevision)
        return { status: 'conflict', revision: doc?.revision ?? 0 };
      state = state.map((one) =>
        one.id === id ? { ...one, html, revision: one.revision + 1 } : one,
      );
      return { status: 'saved', revision: (doc?.revision ?? 0) + 1 };
    },
  };
  return { api, saves, state: () => state };
};

/** The key for a round's draft under test. */
const keyOf = (principal: string, roundId: string, id: string) =>
  `daisy:round-notes:draft:${principal}:${roundId}:${id}`;

describe('draft recovery', () => {
  test('clears recovery after two sequential acknowledged edits', async () => {
    const store = memoryStorage();
    const { api, saves } = savingApi([{ id: 'a', revision: 3 }]);
    const { timers } = manualTimers();
    const sync = createDocumentSync({
      api,
      roundId: 'd',
      principalId: 'p1',
      onConflict: () => {},
      timers,
      storage: store,
      wallClock: () => 1,
    });
    await sync.load();
    sync.change('a', '<p>older A</p>');
    await sync.flush();
    sync.change('a', '<p>newer B</p>');
    await sync.flush();
    const draft = store.dump().get(keyOf('p1', 'd', 'a'));
    assert({
      given: 'two edits saved sequentially',
      should: 'commit both edits in order',
      actual: { saves: saves.length, html: saves.map((s) => s.html) },
      expected: { saves: 2, html: ['<p>older A</p>', '<p>newer B</p>'] },
    });
    assert({
      given: 'the durable copy after the second acknowledgement',
      should: 'be cleared because the latest text is saved',
      actual: draft,
      expected: undefined,
    });
  });

  test('does not auto-apply a recovered draft from an older revision', async () => {
    const store = memoryStorage();
    const now = Date.parse('2026-10-05T18:00:00.000Z');
    store.setItem(
      keyOf('p1', 'd', 'a'),
      JSON.stringify({
        html: '<p>stale draft</p>',
        baseRevision: 2,
        generation: 0,
        savedAt: now,
        expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      }),
    );
    const { api } = savingApi([{ id: 'a', revision: 3 }]);
    const sync = createDocumentSync({
      api,
      roundId: 'd',
      principalId: 'p1',
      onConflict: () => {},
      timers: manualTimers().timers,
      storage: store,
      wallClock: () => now,
    });
    await sync.load();
    const draft = sync.recoveredDrafts().get('a');
    assert({
      given: 'a recovered draft older than the server copy',
      should: 'be preserved for explicit conflict resolution, not auto-saved',
      actual: draft?.html ?? null,
      expected: '<p>stale draft</p>',
    });
  });

  test('the recovered draft is discarded', async () => {
    const store = memoryStorage();
    const now = Date.parse('2026-10-05T18:00:00.000Z');
    store.setItem(
      keyOf('p1', 'd', 'a'),
      JSON.stringify({
        html: '<p>stale draft</p>',
        baseRevision: 2,
        generation: 0,
        savedAt: now,
        expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      }),
    );
    const { api } = savingApi([{ id: 'a', revision: 3 }]);
    const sync = createDocumentSync({
      api,
      roundId: 'd',
      principalId: 'p1',
      onConflict: () => {},
      timers: manualTimers().timers,
      storage: store,
      wallClock: () => now,
    });
    await sync.load();
    sync.discardRecovered('a');
    assert({
      given: 'a recovered draft the room refused',
      should: 'drop the stored draft and leave no recoverable copy',
      actual: [
        store.dump().has(keyOf('p1', 'd', 'a')),
        sync.recoveredDrafts().size,
      ],
      expected: [false, 0],
    });
  });

  test('rejects an invalid stored draft', async () => {
    const store = memoryStorage();
    store.setItem(keyOf('p1', 'd', 'a'), '123');
    const { api } = savingApi([{ id: 'a', revision: 3 }]);
    const sync = createDocumentSync({
      api,
      roundId: 'd',
      principalId: 'p1',
      onConflict: () => {},
      timers: manualTimers().timers,
      storage: store,
    });
    await sync.load();
    assert({
      given: 'a persisted draft that is not a valid record',
      should: 'not be treated as a recoverable draft',
      actual: sync.recoveredDrafts().size,
      expected: 0,
    });
  });
});
