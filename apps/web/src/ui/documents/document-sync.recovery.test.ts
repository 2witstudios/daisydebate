import { DOCUMENT_READ_MAX } from '@daisy/db/documents';
import { listed } from './document-sync.test-support';
import {
  createDocumentSync,
  loadDraftSync,
  recoveryRecord,
  manualDraftResources,
  manualTimers,
  memoryStorage,
  stored,
} from './document-sync.test-support';

import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createDocumentSync as createOwner,
  READ_CHUNK,
  type DocumentsApi,
} from './document-sync';

setupRitewayBun();

const savingApi = (
  documents: readonly { readonly id: string; readonly revision: number }[],
) => {
  let state = documents.map((one) => ({ ...stored(one.id, one.revision) }));
  const saves: { id: string; html: string; expectedRevision: number }[] = [];
  const api: DocumentsApi = {
    ...listed(() => state),
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

/** The key for a document's draft under test. */
const keyOf = (principal: string, id: string) =>
  `daisy:document-drafts:copy:${principal}:${id}`;

const staleRecovery = async (owner: string) => {
  const store = memoryStorage();
  const now = Date.parse('2026-10-05T18:00:00.000Z');
  store.setItem(
    keyOf('p1', 'a'),
    recoveryRecord({
      html: '<p>stale draft</p>',
      baseRevision: 2,
      generation: 'recovered-0',
      savedAt: now,
    }),
  );
  const { api } = savingApi([{ id: 'a', revision: 3 }]);
  const sync = await loadDraftSync({
    ...manualDraftResources(owner, {
      storage: store,
      wallClock: () => now,
    }),

    api,
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
    const sync = await loadDraftSync({
      ...manualDraftResources('document-sync.recovery.test:1', {
        timers,
        storage: store,
        wallClock: () => 1,
      }),

      api,
      principalId: 'p1',
      onConflict: () => {},
    });

    sync.change('a', '<p>older A</p>');
    await sync.flush();
    sync.change('a', '<p>newer B</p>');
    await sync.flush();
    const draft = store.dump().get(keyOf('p1', 'a'));
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
        store.dump().has(keyOf('p1', 'a')),
        sync.recoveryOffers().length,
      ],
      expected: [false, 0],
    });
  });

  test('rejects an invalid stored draft', async () => {
    const store = memoryStorage();
    store.setItem(keyOf('p1', 'a'), '123');
    const { api } = savingApi([{ id: 'a', revision: 3 }]);
    const sync = await loadDraftSync({
      ...manualDraftResources('document-sync.recovery.test:4', {
        storage: store,
      }),

      api,
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

describe('a draft follows its document', () => {
  test('wherever the same person next opens it', async () => {
    const store = memoryStorage();
    const { api } = savingApi([{ id: 'a', revision: 1 }]);
    const resources = () => ({
      ...manualDraftResources('follow', { storage: store }),
      principalId: 'p1',
      api,
      onConflict: () => {},
    });
    const first = await loadDraftSync(resources());
    first.change('a', '<p>typed in the first place</p>');
    first.dispose();
    const second = await loadDraftSync(resources());
    assert({
      given: 'an unsaved edit made while the document was opened elsewhere',
      should: 'offer it where the document opens next',
      actual: second.recoveryOffers().map((offer) => offer.copy.html),
      expected: ['<p>typed in the first place</p>'],
    });
  });

  test('and never to another person', async () => {
    const store = memoryStorage();
    const { api } = savingApi([{ id: 'a', revision: 1 }]);
    const shared = {
      ...manualDraftResources('private', { storage: store }),
      api,
      onConflict: () => {},
    };
    const first = await loadDraftSync({ ...shared, principalId: 'p1' });
    first.change('a', '<p>private</p>');
    first.dispose();
    const second = await loadDraftSync({ ...shared, principalId: 'p2' });
    assert({
      given: 'a draft another account left in this browser',
      should: 'offer nothing',
      actual: second.recoveryOffers().length,
      expected: 0,
    });
  });
});

describe('a stale edit never overwrites', () => {
  test('a read while an edit is pending keeps its base revision', async () => {
    const server = savingApi([{ id: 'a', revision: 1 }]);
    const refused = { value: true };
    const sync = createDocumentSync({
      ...manualDraftResources('stale-edit', { storage: memoryStorage() }),
      principalId: 'p1',
      api: {
        ...server.api,
        save: (input) =>
          refused.value
            ? Promise.reject(Object.assign(new Error('x'), { status: 503 }))
            : server.api.save(input),
      },
      onConflict: () => {},
    });
    await sync.load();
    sync.change('a', '<p>this tab</p>');
    await sync.flush();
    // Another tab saves while this one's edit is still pending; the frame remounts.
    await server.api.save({
      id: 'a',
      html: '<p>other tab</p>',
      expectedRevision: 1,
    });
    await sync.load();
    refused.value = false;
    await sync.flush();
    assert({
      given: 'a pending edit at revision 1, another tab at 2, and a fresh read',
      should:
        'send against 1, so the server refuses it and keeps the other tab',
      actual: server.state().find((one) => one.id === 'a')?.html,
      expected: '<p>other tab</p>',
    });
  });
});

describe('a document deleted elsewhere', () => {
  const deleted = () => {
    const present = { value: true };
    const server = savingApi([{ id: 'a', revision: 1 }]);
    const events: string[] = [];
    const sync = createDocumentSync({
      ...manualDraftResources('deleted', { storage: memoryStorage() }),
      principalId: 'p1',
      api: {
        ...server.api,
        read: async (ids) => (present.value ? server.api.read(ids) : []),
        create: async () => stored('copy', 1),
        recent: async () => (present.value ? 'a' : null),
        save: async (input) =>
          input.id === 'copy'
            ? { status: 'saved', revision: input.expectedRevision + 1 }
            : server.api.save(input),
      },
      onConflict: () => {},
      onGone: (id) => events.push(`gone:${id}`),
      onSaved: () => events.push('saved'),
    });
    return { sync, present, events, server };
  };

  test('recheck marks it, and only once', async () => {
    const { sync, present, events } = deleted();
    await sync.load();
    present.value = false;
    await sync.recheck(['a']);
    await sync.recheck(['a']);
    assert({
      given: 'an open document the server no longer has, looked at twice',
      should: 'mark it gone and say so once',
      actual: [sync.firstGone(), events.filter((e) => e.startsWith('gone'))],
      expected: ['a', ['gone:a']],
    });
  });

  test('saving it as new keeps the text with nothing pending', async () => {
    const { sync, present, events } = deleted();
    await sync.load();
    await sync.flush();
    present.value = false;
    await sync.recheck(['a']);
    const created = await sync.saveAsNew('a');
    await sync.flush();
    assert({
      given: 'a saved document deleted elsewhere',
      should: 'carry its text across, clear the mark and say saved',
      actual: [
        created?.id,
        created?.html.includes('<p>'),
        created?.html === stored('copy', 1).html,
        sync.firstGone(),
        events.at(-1),
      ],
      expected: ['copy', true, true, null, 'saved'],
    });
  });

  test('saving it as new keeps what was typed', async () => {
    const { sync, present } = deleted();
    await sync.load();
    sync.change('a', '<p>typed</p>');
    present.value = false;
    await sync.recheck(['a']);
    const created = await sync.saveAsNew('a');
    assert({
      given: 'typed text on a document deleted elsewhere',
      should: 'carry the typed text',
      actual: created?.html,
      expected: '<p>typed</p>',
    });
  });

  test('forgetting it removes its draft', async () => {
    const { sync } = deleted();
    await sync.load();
    sync.change('a', '<p>typed</p>');
    sync.forget('a');
    assert({
      given: 'a person deleting a document here',
      should: 'keep no offer of it',
      actual: sync.recoveryOffers(),
      expected: [],
    });
  });
});

describe('a browser full of drafts', () => {
  test('sixteen drafts and the last edited all load', async () => {
    const store = memoryStorage();
    const ids = Array.from({ length: 17 }, (_, i) => `d${i}`);
    const asked: number[] = [];
    for (const id of ids.slice(0, 16))
      store.setItem(
        keyOf('p1', id),
        recoveryRecord({
          html: `<p>${id}</p>`,
          baseRevision: 1,
          generation: `gen-${id}`,
          savedAt: 100,
        }),
      );
    const sync = createOwner({
      ...manualDraftResources('full', { storage: store }),
      principalId: 'p1',
      api: {
        read: async (wanted) => {
          asked.push(wanted.length);
          return wanted.map((id) => stored(id, 1));
        },
        recent: async () => 'd16',
        create: async () => stored('new'),
        save: async () => ({ status: 'saved', revision: 2 }),
      },
      onConflict: () => {},
    });
    const loaded = await sync.load();
    assert({
      given: 'seventeen documents to read at load',
      should: 'read them all, none in a request over the route’s limit',
      actual: [
        loaded.length,
        Math.max(...asked) <= READ_CHUNK,
        READ_CHUNK === DOCUMENT_READ_MAX,
      ],
      expected: [17, true, true],
    });
  });
});
