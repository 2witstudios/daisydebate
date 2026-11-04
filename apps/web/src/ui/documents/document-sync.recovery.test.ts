import { newDraftCopy } from '../../features/documents/document-draft';
import {
  documentSaving,
  initialSaveStatus,
  reduceSave,
  type SaveEvent,
} from './use-document-saving';
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

describe('a mount on an owner still holding an edit', () => {
  test('shows what was typed, not the older server text', async () => {
    const server = savingApi([{ id: 'a', revision: 1 }]);
    const sync = createOwner({
      ...manualDraftResources('mount', { storage: memoryStorage() }),
      principalId: 'p1',
      api: {
        ...server.api,
        save: () =>
          Promise.reject(Object.assign(new Error('x'), { status: 503 })),
      },
      onConflict: () => {},
    });
    await sync.load();
    sync.change('a', '<p>typed</p>');
    await sync.flush();
    const [shown] = await sync.load();
    const opened = await sync.open('a');
    assert({
      given: 'a save refused for capacity, then the frame remounting',
      should: 'hand the editor the typed text from load and from open',
      actual: [shown?.html, opened?.html],
      expected: ['<p>typed</p>', '<p>typed</p>'],
    });
  });
});

describe('a deletion here', () => {
  test('a save still in flight cannot bring the document back', async () => {
    let answer!: (error: Error) => void;
    const server = savingApi([{ id: 'a', revision: 1 }]);
    const sync = createOwner({
      ...manualDraftResources('in-flight', { storage: memoryStorage() }),
      principalId: 'p1',
      api: {
        ...server.api,
        save: () =>
          new Promise((_, reject) => {
            answer = reject;
          }),
      },
      onConflict: () => {},
    });
    await sync.load();
    sync.change('a', '<p>typed</p>');
    const flushing = sync.flush();
    await Promise.resolve();
    sync.forget('a');
    answer(Object.assign(new Error('gone'), { status: 404 }));
    await flushing;
    assert({
      given: 'a 404 answering a save sent before the person deleted it here',
      should: 'not say it was deleted elsewhere',
      actual: sync.firstGone(),
      expected: null,
    });
  });

  test('two clicks on Save as a new document make one', async () => {
    let creates = 0;
    let present = true;
    const server = savingApi([{ id: 'a', revision: 1 }]);
    const sync = createOwner({
      ...manualDraftResources('two-clicks', { storage: memoryStorage() }),
      principalId: 'p1',
      api: {
        ...server.api,
        read: async (ids) => (present ? server.api.read(ids) : []),
        recent: async () => 'a',
        create: async () => {
          creates += 1;
          return stored('copy', 1);
        },
        save: async ({ expectedRevision }) => ({
          status: 'saved',
          revision: expectedRevision + 1,
        }),
      },
      onConflict: () => {},
    });
    await sync.load();
    present = false;
    await sync.recheck(['a']);
    await Promise.all([sync.saveAsNew('a'), sync.saveAsNew('a')]);
    assert({
      given: 'a double click',
      should: 'create one document',
      actual: creates,
      expected: 1,
    });
  });
});

describe('typing while a copy is being made', () => {
  test('what is typed during the create goes with it', async () => {
    const server = savingApi([{ id: 'a', revision: 1 }]);
    let answer!: () => void;
    let present = true;
    const sync = createOwner({
      ...manualDraftResources('during', { storage: memoryStorage() }),
      principalId: 'p1',
      api: {
        ...server.api,
        read: async (ids) => (present ? server.api.read(ids) : []),
        recent: async () => 'a',
        create: () =>
          new Promise((resolve) => {
            answer = () => resolve(stored('copy', 1));
          }),
        save: async ({ id, html, expectedRevision }) =>
          id === 'a'
            ? Promise.reject(Object.assign(new Error('x'), { status: 404 }))
            : { status: 'saved', revision: expectedRevision + 1, html },
      },
      onConflict: () => {},
    });
    await sync.load();
    sync.change('a', '<p>brief</p>');
    present = false;
    await sync.recheck(['a']);
    const copying = sync.saveAsNew('a');
    await Promise.resolve();
    sync.change('a', '<p>brief and more</p>');
    answer();
    const created = await copying;
    assert({
      given: 'typing while the new document is being created',
      should: 'carry the latest text',
      actual: created?.html,
      expected: '<p>brief and more</p>',
    });
  });

  test('an offer from elsewhere survives saving as new', async () => {
    const store = memoryStorage();
    store.setItem(
      keyOf('p1', 'a'),
      recoveryRecord({
        html: '<p>earlier session</p>',
        baseRevision: 1,
        generation: 'earlier',
        savedAt: 100,
      }),
    );
    let present = true;
    const server = savingApi([{ id: 'a', revision: 1 }]);
    const sync = createOwner({
      ...manualDraftResources('offer', { storage: store }),
      principalId: 'p1',
      api: {
        ...server.api,
        read: async (ids) => (present ? server.api.read(ids) : []),
        recent: async () => 'a',
        create: async () => stored('copy', 1),
      },
      onConflict: () => {},
    });
    await sync.load();
    present = false;
    await sync.recheck(['a']);
    await sync.saveAsNew('a');
    assert({
      given: 'a stored copy on a document deleted elsewhere, then Save as new',
      should: 'keep that copy stored and go on offering it',
      actual: [
        store.getItem(keyOf('p1', 'a'))?.includes('earlier session'),
        sync.firstNeedingCopy(),
      ],
      expected: [true, 'a'],
    });
  });
});

describe('a conflict with full draft slots', () => {
  test('never says reload, and offers a way out that keeps the text', async () => {
    const store = memoryStorage();
    const copy = (generation: string, html: string) =>
      newDraftCopy({ generation, html, baseRevision: 1, now: 100 });
    store.setItem(
      keyOf('p1', 'a'),
      JSON.stringify({
        active: copy('foreign-a', '<p>tab one</p>'),
        recovery: copy('foreign-b', '<p>tab two</p>'),
      }),
    );
    const server = savingApi([{ id: 'a', revision: 1 }]);
    const events: SaveEvent[] = [];
    const sync = documentSaving(
      'p1',
      {
        ...server.api,
        create: async () => stored('copy', 1),
      },
      (event) => events.push(event),
      manualDraftResources('full-slots', {
        storage: store,
        wallClock: () => 200,
      }),
    );
    await sync.load();
    sync.change('a', '<p>typed now</p>');
    await server.api.save({
      id: 'a',
      html: '<p>other</p>',
      expectedRevision: 1,
    });
    await sync.flush();
    const conflict = events.filter((event) => event.type === 'conflict').at(-1);
    const held = sync.firstNeedingCopy();
    const created = await sync.saveAsNew('a');
    assert({
      given: 'typing that could not be stored, then a commit elsewhere',
      should:
        'name it unstored, not say reload, and save it as new on the page',
      actual: {
        unstored: conflict,
        says: reduceSave(initialSaveStatus, conflict!).notice?.includes(
          'Reload',
        ),
        held,
        copied: created?.html,
      },
      expected: {
        unstored: { type: 'conflict', unstored: true },
        says: false,
        held: 'a',
        copied: '<p>typed now</p>',
      },
    });
  });
});

describe('after Save as new', () => {
  test('a deleted document offers each remaining copy, then is gone', async () => {
    const store = memoryStorage();
    store.setItem(
      keyOf('p1', 'a'),
      recoveryRecord({
        html: '<p>earlier session</p>',
        baseRevision: 1,
        generation: 'earlier',
        savedAt: 100,
      }),
    );
    let present = true;
    const server = savingApi([{ id: 'a', revision: 1 }]);
    const sync = createOwner({
      ...manualDraftResources('each', { storage: store }),
      principalId: 'p1',
      api: {
        ...server.api,
        read: async (ids) => (present ? server.api.read(ids) : []),
        recent: async () => 'a',
        create: async () => stored('copy', 1),
      },
      onConflict: () => {},
    });
    await sync.load();
    present = false;
    await sync.recheck(['a']);
    const first = await sync.saveAsNew('a');
    const stillOffered = sync.firstNeedingCopy();
    const second = await sync.saveAsNew('a');
    assert({
      given: 'a deleted document with its text and one stored copy',
      should: 'carry the text, then the copy, then have nothing left',
      actual: [
        first?.html === stored('a', 1).html,
        stillOffered,
        second?.html,
        sync.firstNeedingCopy(),
        store.getItem(keyOf('p1', 'a')),
      ],
      expected: [true, 'a', '<p>earlier session</p>', null, null],
    });
  });

  test('the old copy stays until the new one is stored', async () => {
    const store = memoryStorage();
    for (let i = 0; i < 15; i += 1)
      store.setItem(
        keyOf('p1', `other${i}`),
        recoveryRecord({
          html: '<p>x</p>',
          baseRevision: 1,
          generation: `g${i}`,
          savedAt: 100,
        }),
      );
    store.setItem(
      keyOf('p1', 'a'),
      recoveryRecord({
        html: '<p>only copy</p>',
        baseRevision: 1,
        generation: 'only',
        savedAt: 100,
      }),
    );
    let present = true;
    const server = savingApi([{ id: 'a', revision: 1 }]);
    const sync = createOwner({
      ...manualDraftResources('store-full', { storage: store }),
      principalId: 'p1',
      api: {
        ...server.api,
        read: async (ids) =>
          present ? server.api.read(ids.filter((id) => id === 'a')) : [],
        recent: async () => 'a',
        create: async () => stored('copy', 1),
      },
      onConflict: () => {},
    });
    await sync.load();
    present = false;
    await sync.recheck(['a']);
    await sync.saveAsNew('a');
    await sync.saveAsNew('a');
    assert({
      given: 'a browser with no room to store the new document’s copy',
      should: 'keep the only stored copy of the old text',
      actual: store.getItem(keyOf('p1', 'a'))?.includes('only copy'),
      expected: true,
    });
  });

  test('a fresh frame shows the text its revision belongs to', async () => {
    const server = savingApi([{ id: 'a', revision: 1 }]);
    const sync = createOwner({
      ...manualDraftResources('fresh-frame', { storage: memoryStorage() }),
      principalId: 'p1',
      api: server.api,
      onConflict: () => {},
    });
    const [first] = await sync.load();
    await server.api.save({
      id: 'a',
      html: '<p>elsewhere</p>',
      expectedRevision: 1,
    });
    const [again] = await sync.load();
    assert({
      given: 'a commit elsewhere, then a fresh frame on the same owner',
      should: 'show what the next save is based on, not the newer text',
      actual: again?.html,
      expected: first?.html,
    });
  });
});
