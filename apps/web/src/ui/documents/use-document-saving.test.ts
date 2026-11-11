import { listed } from './document-sync.test-support';
import {
  documentApi,
  recoveryRecord,
  manualDraftResources,
  manualTimers,
  memoryStorage,
  stored,
} from './document-sync.test-support';

import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { DocumentsApi } from './document-sync';

import { RETRYING_NOTICE, refusedNotice } from './save-notice';
import {
  initialSavePage,
  reduceOwnedSave,
  reduceSave,
  documentSaving,
  saveStatusOf,
  type SaveEvent,
} from './use-document-saving';

setupRitewayBun();

const saved = { save: 'saved', notice: null } as const;
const after = (...events: SaveEvent[]) =>
  saveStatusOf(events.reduce(reduceSave, initialSavePage));
const a = { documentId: 'a' } as const;
const b = { documentId: 'b' } as const;

describe('reduceSave', () => {
  test('the save state and notice', () => {
    assert({
      given:
        'an edit, a failed save that retries, a refusal, a conflict, and a save after a retry',
      should:
        'show Saving, then Not saved with the matching notice, and Saved with no notice once stored',
      actual: [
        after({ type: 'edit', ...a }),
        after({ type: 'edit', ...a }, { type: 'retrying', ...a }),
        after({ type: 'refused', status: 413, ...a }),
        after({ type: 'conflict', unstored: false, ...a }).save,
        after({ type: 'retrying', ...a }, { type: 'saved', ...a }),
      ],
      expected: [
        { save: 'saving', notice: null },
        { save: 'unsaved', notice: RETRYING_NOTICE },
        { save: 'unsaved', notice: refusedNotice(413) },
        'unsaved',
        saved,
      ],
    });
  });

  test('one document\u2019s save never hides another\u2019s warning', () => {
    const warnings: SaveEvent[] = [
      { type: 'gone', ...a },
      { type: 'conflict', unstored: true, ...a },
      { type: 'conflict', unstored: false, ...a },
      { type: 'refused', status: 403, ...a },
      { type: 'retrying', ...a },
      { type: 'unsaved', ...a },
    ];
    for (const warning of warnings) {
      const alone = after(warning);
      assert({
        given: `a ${warning.type} on one document, then another edited and saved`,
        should:
          'stay Not saved with the first document\u2019s notice through the edit and after the save',
        actual: [
          after(warning, { type: 'edit', ...b }),
          after(warning, { type: 'edit', ...b }, { type: 'saved', ...b }),
        ],
        expected: [alone, alone],
      });
    }
  });

  test('the most serious notice is the one shown', () => {
    const unstored: SaveEvent = { type: 'conflict', unstored: true, ...a };
    assert({
      given:
        'typing a reload would lose on one document and a retry on another, in either order',
      should: 'show the warning about losing text',
      actual: [
        after(unstored, { type: 'retrying', ...b }),
        after({ type: 'retrying', ...b }, unstored),
      ],
      expected: [after(unstored), after(unstored)],
    });
  });

  test('an edit never carries a conflict or a deletion into Saving', () => {
    assert({
      given:
        'a restore that resolves a conflict, one on a deleted document, and an edit while a save retries',
      should:
        'say Saving with no notice for the first two, and keep the retry notice for the third',
      actual: [
        after(
          { type: 'conflict', unstored: false, ...a },
          { type: 'edit', ...a },
        ),
        after({ type: 'gone', ...a }, { type: 'edit', ...a }),
        after({ type: 'retrying', ...a }, { type: 'edit', ...a }),
      ],
      expected: [
        { save: 'saving', notice: null },
        { save: 'saving', notice: null },
        { save: 'saving', notice: RETRYING_NOTICE },
      ],
    });
  });

  test('a draft on offer keeps the room unsaved until it is gone', () => {
    const offer: SaveEvent = { type: 'recovered', draftOnOffer: true };
    const offered = after(offer);
    assert({
      given:
        'a recovered draft offered, another document saving and saved, a conflict beside it, then the offer gone',
      should:
        'offer the draft while nothing worse stands, yield to the conflict, and read Saved once no offer is left',
      actual: [
        offered.save,
        after(offer, { type: 'edit', ...b }),
        after(offer, { type: 'edit', ...b }, { type: 'saved', ...b }),
        after(offer, { type: 'conflict', unstored: false, ...b }).notice ===
          offered.notice,
        after(offer, { type: 'recovered', draftOnOffer: false }),
      ],
      expected: [
        'unsaved',
        { save: 'saving', notice: offered.notice },
        offered,
        false,
        saved,
      ],
    });
  });
});

test('a new owner\u2019s page starts from nothing', () => {
  const first = reduceOwnedSave(
    { owner: 'one', page: initialSavePage },
    { owner: 'one', event: { type: 'refused', status: 401, ...a } },
  );
  const taken = reduceOwnedSave(first, { owner: 'two', event: 'took-over' });
  const late = reduceOwnedSave(taken, {
    owner: 'one',
    event: { type: 'retrying', ...a },
  });
  const edited = reduceOwnedSave(late, {
    owner: 'two',
    event: { type: 'edit', ...b },
  });
  assert({
    given:
      'a refused save left by one owner, another owner taking the page, a late answer to the first, then the new owner\u2019s edit',
    should:
      'start the new owner from Saved, ignore the late answer, and say only what the new owner\u2019s documents say',
    actual: [
      saveStatusOf(first.page).save,
      saveStatusOf(taken.page),
      late === taken,
      saveStatusOf(edited.page),
    ],
    expected: ['unsaved', saved, true, { save: 'saving', notice: null }],
  });
});

describe('documentSaving', () => {
  const api = (save: DocumentsApi['save']): DocumentsApi => ({
    ...listed(() => [stored('a')]),
    create: async () => stored('b'),
    save,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  test('a save that lands', async () => {
    const events: SaveEvent[] = [];
    const { timers, fire } = manualTimers();
    const sync = documentSaving(
      'user',
      api(async () => ({ status: 'saved', revision: 2 })),
      (event) => events.push(event),
      {
        ...manualDraftResources('use-round-sync.test:1', {
          timers,
          storage: memoryStorage(),
        }),
      },
    );
    await sync.load();
    sync.change('a', '<p>edited</p>');
    fire();
    await settle();
    assert({
      given: 'an edit that the server stores',
      should: 'report the edit, then the save',
      actual: events.map((e) => e.type),
      expected: ['edit', 'saved'],
    });
  });

  test('a save that fails', async () => {
    const events: SaveEvent[] = [];
    const { timers, fire } = manualTimers();
    const sync = documentSaving(
      'user',
      api(async () => {
        throw new Error('offline');
      }),
      (event) => events.push(event),
      {
        ...manualDraftResources('use-round-sync.test:2', {
          timers,
          storage: memoryStorage(),
        }),
      },
    );
    await sync.load();
    sync.change('a', '<p>edited</p>');
    fire();
    await settle();
    assert({
      given: 'an edit whose save cannot reach the server',
      should: 'report the edit, then a retry',
      actual: events.map((e) => e.type),
      expected: ['edit', 'retrying'],
    });
  });
});

test('browser resource composition shares exact serialized exit capacity across owners', async () => {
  const { browserDraftResources } = await import('./use-document-saving');
  const { createDocumentsApi } = await import('./documents-api');
  const gate = Promise.withResolvers<void>();
  const sent: string[] = [];
  const api = (id: string) =>
    createDocumentsApi({
      send: async (path, init) => {
        if (path.endsWith('/recent')) return Response.json({ id: id });
        if (path.endsWith('/read'))
          return Response.json({ documents: [stored(id)] });
        sent.push(String(init.body));
        await gate.promise;
        return Response.json({ revision: 2 });
      },
    });
  const resources = () => ({
    ...browserDraftResources(),
    timers: manualTimers().timers,
    storage: memoryStorage(),
    wallClock: () => 100,
  });
  const oneResources = resources(),
    twoResources = resources();
  const one = documentSaving('p', api('a'), () => {}, oneResources);
  const two = documentSaving('p', api('b'), () => {}, twoResources);
  await one.load();
  await two.load();
  one.change('a', 'é'.repeat(20_000));
  two.change('b', '界'.repeat(14_000));
  const pending = [one.flushKeepalive(), two.flushKeepalive()];
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert({
    given:
      'two actual Round adapters using the browser resource factory and serialized HTTP transport',
    should:
      'dispatch only the body fitting the shared limit and retain overflow locally',
    actual: [
      sent.length,
      sent.reduce((n, body) => n + new TextEncoder().encode(body).length, 0) <=
        65536,
      twoResources.storage.length,
    ],
    expected: [1, true, 1],
  });
  gate.resolve();
  await Promise.all(pending);
  assert({
    given: 'those requests settle',
    should: 'release their exact reservations for the next owner',
    actual: oneResources.budget.total(),
    expected: 0,
  });
});

test('refused edits and absent recovery choices leave the real owner state unchanged', async () => {
  const events: SaveEvent[] = [];
  const api: DocumentsApi = {
    ...listed(() => [stored('a')]),
    create: async () => stored('b'),
    save: async () => ({ status: 'saved', revision: 2 }),
  };
  const sync = documentSaving('p', api, (event) => events.push(event), {
    ...manualDraftResources('use-round-sync.test:3', {
      storage: memoryStorage(),
    }),
  });
  await sync.load();
  sync.restoreRecovered('missing', 'absent');
  sync.change('not-loaded', '<p>refused</p>');
  sync.change('a', '<p>accepted</p>');
  await sync.flush();
  assert({
    given:
      'an absent recovery choice and an unknown document followed by a valid edit',
    should:
      'ignore refused operations and acknowledge only the actual pending edit',
    actual: events.map((event) => event.type),
    expected: ['edit', 'saved'],
  });
});

test('a recovery choice remains actionable after newer typing is acknowledged', async () => {
  const storage = memoryStorage();
  storage.setItem(
    'daisy:document-drafts:copy:p:a',
    recoveryRecord({
      html: '<p>Recovered copy</p>',
      baseRevision: 1,
      generation: 'recovered-0',
      savedAt: 100,
    }),
  );
  let document = stored('a');
  const api: DocumentsApi = documentApi(
    async ({ html, expectedRevision }) => {
      if (expectedRevision !== document.revision)
        return { status: 'conflict', revision: document.revision };
      document = { ...document, html, revision: document.revision + 1 };
      return { status: 'saved', revision: document.revision };
    },
    () => [document],
  );
  const sync = documentSaving('p', api, () => {}, {
    ...manualDraftResources('use-round-sync.test:4', { storage }),
  });
  await sync.load();
  const offered = sync
    .recoveryOffers()
    .find((offer) => offer.documentId === 'a')?.copy;
  sync.change('a', '<p>New typing</p>');
  await sync.flush();
  sync.restoreRecovered(
    'a',
    sync.recoveryOffers().find((offer) => offer.documentId === 'a')!.copy
      .generation,
  );
  await sync.flush();
  assert({
    given: 'the UI still offers recovery while a newer editor edit saves',
    should: 'honor the explicit Restore on the current acknowledged revision',
    actual: [offered?.html, document.html, document.revision],
    expected: ['<p>Recovered copy</p>', '<p>Recovered copy</p>', 3],
  });
});

for (const status of [401, 403] as const)
  test(`a ${status} refused save keeps every private copy`, async () => {
    const storage = memoryStorage();
    storage.setItem(
      'daisy:document-drafts:copy:p:other-round:x',
      recoveryRecord({
        html: '<p>Other Round</p>',
        baseRevision: 1,
        generation: 'other',
        savedAt: 100,
      }),
    );
    const api: DocumentsApi = documentApi(
      async () => {
        throw Object.assign(new Error('refused'), { status });
      },
      () => [stored('a')],
    );
    const events: SaveEvent[] = [];
    const sync = documentSaving('p', api, (event) => events.push(event), {
      ...manualDraftResources(`use-round-sync.test:${status}`, { storage }),
    });
    await sync.load();
    sync.change('a', '<p>Typed before refusal</p>');
    await sync.flush();
    assert({
      given: `a save refused with ${status}`,
      should:
        '401 fences the owner and 403 leaves it working, with both drafts on disk',
      actual: [
        sync.available(),
        events.at(-1),
        storage
          .getItem('daisy:document-drafts:copy:p:a')
          ?.includes('Typed before'),
        storage.getItem('daisy:document-drafts:copy:p:other-round:x') !== null,
      ],
      expected: [
        status === 403,
        { type: 'refused', documentId: 'a', status },
        true,
        true,
      ],
    });
  });

for (const status of [404, 403] as const)
  test(`another document\u2019s save lands beside a ${status} that keeps its notice`, async () => {
    const events: SaveEvent[] = [];
    const api: DocumentsApi = {
      ...listed(() => [stored('a'), stored('b')]),
      create: async () => stored('c'),
      save: async ({ id }) => {
        if (id === 'a') throw Object.assign(new Error('refused'), { status });
        return { status: 'saved', revision: 2 };
      },
    };
    const sync = documentSaving('p', api, (event) => events.push(event), {
      ...manualDraftResources(`use-round-sync.test:cross-${status}`, {
        storage: memoryStorage(),
      }),
    });
    await sync.load();
    await sync.open('b');
    sync.change('a', '<p>Kept only here</p>');
    await sync.flush();
    const warned = saveStatusOf(events.reduce(reduceSave, initialSavePage));
    sync.change('b', '<p>Other document</p>');
    await sync.flush();
    assert({
      given: `a document whose save answered ${status}, then another document edited and stored`,
      should:
        'report the second document saved, and leave the room Not saved with the first one\u2019s notice',
      actual: [
        events.at(-1),
        saveStatusOf(events.reduce(reduceSave, initialSavePage)),
      ],
      expected: [{ type: 'saved', documentId: 'b' }, warned],
    });
  });
