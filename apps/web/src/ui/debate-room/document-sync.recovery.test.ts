import {
  loadNoteSync,
  recoveryRecord,
  manualNoteResources,
  manualTimers,
  memoryStorage,
  stored,
} from './document-sync.test-support';

import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { type DocumentsApi } from './document-sync';

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

const staleRecovery = async (owner: string) => {
  const store = memoryStorage();
  const now = Date.parse('2026-10-05T18:00:00.000Z');
  store.setItem(
    keyOf('p1', 'd', 'a'),
    recoveryRecord({
      html: '<p>stale draft</p>',
      baseRevision: 2,
      generation: 'recovered-0',
      savedAt: now,
    }),
  );
  const { api } = savingApi([{ id: 'a', revision: 3 }]);
  const sync = await loadNoteSync({
    ...manualNoteResources(owner, {
      storage: store,
      wallClock: () => now,
    }),

    api,
    roundId: 'd',
    principalId: 'p1',
    onConflict: () => {},
  });

  return { store, sync };
};

describe('draft recovery', () => {
  test('clears recovery after two sequential acknowledged edits', async () => {
    const store = memoryStorage();
    const { api, saves } = savingApi([{ id: 'a', revision: 3 }]);
    const { timers } = manualTimers();
    const sync = await loadNoteSync({
      ...manualNoteResources('document-sync.recovery.test:1', {
        timers,
        storage: store,
        wallClock: () => 1,
      }),

      api,
      roundId: 'd',
      principalId: 'p1',
      onConflict: () => {},
    });

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
    const { sync } = await staleRecovery('document-sync.recovery.test:2');
    const draft = sync
      .recoveryOffers()
      .find((offer) => offer.documentId === 'a')?.copy;
    assert({
      given: 'a recovered draft older than the server copy',
      should: 'be preserved for explicit conflict resolution, not auto-saved',
      actual: draft?.html ?? null,
      expected: '<p>stale draft</p>',
    });
  });

  test('the recovered draft is discarded', async () => {
    const { store, sync } = await staleRecovery(
      'document-sync.recovery.test:3',
    );
    sync.discardRecovered(
      'a',
      sync.recoveryOffers().find((offer) => offer.documentId === 'a')!.copy
        .generation,
    );
    assert({
      given: 'a recovered draft the room refused',
      should: 'drop the stored draft and leave no recoverable copy',
      actual: [
        store.dump().has(keyOf('p1', 'd', 'a')),
        sync.recoveryOffers().length,
      ],
      expected: [false, 0],
    });
  });

  test('rejects an invalid stored draft', async () => {
    const store = memoryStorage();
    store.setItem(keyOf('p1', 'd', 'a'), '123');
    const { api } = savingApi([{ id: 'a', revision: 3 }]);
    const sync = await loadNoteSync({
      ...manualNoteResources('document-sync.recovery.test:4', {
        storage: store,
      }),

      api,
      roundId: 'd',
      principalId: 'p1',
      onConflict: () => {},
    });

    assert({
      given: 'a persisted draft that is not a valid record',
      should: 'not be treated as a recoverable draft',
      actual: sync.recoveryOffers().length,
      expected: 0,
    });
  });
});
