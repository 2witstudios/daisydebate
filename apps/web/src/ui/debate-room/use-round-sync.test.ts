import {
  documentApi,
  recoveryRecord,
  manualNoteResources,
  manualTimers,
  memoryStorage,
  stored,
} from './document-sync.test-support';

import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { DocumentsApi } from './document-sync';

import { RETRYING_NOTICE, refusedNotice } from './save-notice';
import {
  initialSaveStatus,
  reduceSave,
  roundSync,
  type SaveEvent,
} from './use-round-sync';

setupRitewayBun();

describe('reduceSave', () => {
  test('the save state and notice', () => {
    const after = (...events: SaveEvent[]) =>
      events.reduce(reduceSave, initialSaveStatus);
    assert({
      given:
        'an edit, a failed save that retries, a refusal, a conflict, and a save after a retry',
      should:
        'show Saving, then Not saved with the matching notice, and Saved with no notice once stored',
      actual: [
        after({ type: 'edit' }),
        after({ type: 'edit' }, { type: 'retrying' }),
        after({ type: 'refused', status: 413 }),
        after({ type: 'conflict' }).save,
        after({ type: 'retrying' }, { type: 'saved' }),
      ],
      expected: [
        { save: 'saving', notice: null },
        { save: 'unsaved', notice: RETRYING_NOTICE },
        { save: 'unsaved', notice: refusedNotice(413) },
        'unsaved',
        initialSaveStatus,
      ],
    });
  });
});

describe('roundSync', () => {
  const api = (save: DocumentsApi['save']): DocumentsApi => ({
    list: async () => [stored('a')],
    create: async () => stored('b'),
    save,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  test('a save that lands', async () => {
    const events: SaveEvent[] = [];
    const { timers, fire } = manualTimers();
    const sync = roundSync(
      'r',
      'user',
      api(async () => ({ status: 'saved', revision: 2 })),
      (event) => events.push(event),
      {
        ...manualNoteResources('use-round-sync.test:1', {
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
    const sync = roundSync(
      'r',
      'user',
      api(async () => {
        throw new Error('offline');
      }),
      (event) => events.push(event),
      {
        ...manualNoteResources('use-round-sync.test:2', {
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
  const { browserNoteResources } = await import('./use-round-sync');
  const { createDocumentsApi } = await import('./documents-api');
  const gate = Promise.withResolvers<void>();
  const sent: string[] = [];
  const api = (id: string) =>
    createDocumentsApi({
      send: async (path, init) => {
        if (path.endsWith('/list'))
          return Response.json({ documents: [stored(id)] });
        sent.push(String(init.body));
        await gate.promise;
        return Response.json({ revision: 2 });
      },
    });
  const resources = () => ({
    ...browserNoteResources(),
    timers: manualTimers().timers,
    storage: memoryStorage(),
    wallClock: () => 100,
  });
  const oneResources = resources(),
    twoResources = resources();
  const one = roundSync('r1', 'p', api('a'), () => {}, oneResources);
  const two = roundSync('r2', 'p', api('b'), () => {}, twoResources);
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
    list: async () => [stored('a')],
    create: async () => stored('b'),
    save: async () => ({ status: 'saved', revision: 2 }),
  };
  const sync = roundSync('r', 'p', api, (event) => events.push(event), {
    ...manualNoteResources('use-round-sync.test:3', {
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
    'daisy:round-notes:draft:p:r:a',
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
  const sync = roundSync('r', 'p', api, () => {}, {
    ...manualNoteResources('use-round-sync.test:4', { storage }),
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
