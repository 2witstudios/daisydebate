import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createDocumentSync,
  type DocumentsApi,
  draftKeys,
} from './document-sync';
import {
  manualTimers,
  memoryStorage,
  stored,
} from './document-sync.test-support';

setupRitewayBun();

const htmlOf = (size: number) => `<p>${'x'.repeat(Math.max(size - 13, 0))}</p>`;
const keyOf = (principal: string, roundId: string, id: string) =>
  `daisy:round-notes:draft:${principal}:${roundId}:${id}`;

const alwaysSaving = (documents: readonly string[] = ['a']): DocumentsApi => ({
  list: async () => documents.map((id) => stored(id, 1)),
  create: async () => stored('new'),
  save: async ({ expectedRevision }) => ({
    status: 'saved',
    revision: expectedRevision + 1,
  }),
});

describe('a durable draft', () => {
  test('survives a reload and is not auto-applied when stale', async () => {
    const store = memoryStorage();
    const now = 1;
    store.setItem(
      keyOf('p1', 'd', 'a'),
      JSON.stringify({
        html: '<p>stale draft</p>',
        baseRevision: 0,
        savedAt: now,
        expiresAt: Number.MAX_SAFE_INTEGER,
      }),
    );
    const sync = createDocumentSync({
      api: alwaysSaving(),
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
      given: 'a durable stale draft against a newer server document',
      should: 'be recoverable, not auto-saved over the server copy',
      actual: {
        html: draft?.html,
        waiting: store.dump().has(keyOf('p1', 'd', 'a')),
      },
      expected: { html: '<p>stale draft</p>', waiting: true },
    });
  });

  test('discarding removes the durable record and the pending edit', async () => {
    const store = memoryStorage();
    const now = 1;
    const { api } = { api: alwaysSaving() } as { api: DocumentsApi };
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
    sync.change('a', '<p>typed</p>');
    await sync.flush();
    sync.discardRecovered('a');
    assert({
      given: 'a saved draft whose session is now gone',
      should: 'leave no durable copy',
      actual: store.dump().has(keyOf('p1', 'd', 'a')),
      expected: false,
    });
  });
});

describe('the ordinary flush', () => {
  test('sends a oversized document, not the exit cap', async () => {
    const sent: string[] = [];
    const sync = createDocumentSync({
      api: {
        list: async () => [stored('a', 1)],
        create: async () => stored('new'),
        save: async ({ html, expectedRevision }) => {
          sent.push(html);
          return { status: 'saved', revision: expectedRevision + 1 };
        },
      },
      roundId: 'r',
      principalId: 'p1',
      onConflict: () => {},
      timers: manualTimers().timers,
      storage: null,
    });
    await sync.load();
    sync.change('a', htmlOf(70 * 1024));
    await sync.flush();
    assert({
      given: 'a 70 KiB document saved with the ordinary flush',
      should: 'send its full body once',
      actual: [sent.length, sent[0]?.length],
      expected: [1, 71_674],
    });
  });
});

describe('an overlapping exit flush', () => {
  test('reserves bytes across outstanding sends, not just per call', async () => {
    const settle: { resolve: () => void } = { resolve: () => {} };
    const gate = new Promise<void>((resolve) => {
      settle.resolve = resolve;
    });
    const sent: string[] = [];
    const sync = createDocumentSync({
      api: {
        list: async () => [stored('a', 1), stored('b', 1)],
        create: async () => stored('new'),
        save: async ({ html, expectedRevision }) => {
          sent.push(html);
          await gate;
          return { status: 'saved', revision: expectedRevision + 1 };
        },
      },
      roundId: 'r',
      principalId: 'p1',
      onConflict: () => {},
      timers: manualTimers().timers,
      storage: null,
    });
    await sync.load();
    sync.change('a', htmlOf(26_000));
    sync.change('b', htmlOf(60_000));
    // The first flush reserves A while its send is outstanding; the second
    // flush must see that reservation before judging B.
    const flushing = sync.flushKeepalive();
    const second = sync.flushKeepalive();
    settle.resolve();
    await Promise.all([flushing, second]);
    assert({
      given:
        'A made into a 26 KiB recovery, then B typed while A was overflowing',
      should: 'not admit the second body over the 64 KiB budget',
      actual: sent.length,
      expected: 1,
    });
  });
});

describe('an eviction round', () => {
  test('evicts the oldest draft when storage is full', async () => {
    const store = memoryStorage();
    const ids = Array.from({ length: 17 }, (_, n) => `d${n}`);
    const sync = createDocumentSync({
      api: alwaysSaving(ids),
      roundId: 'r',
      principalId: 'p1',
      onConflict: () => {},
      timers: manualTimers().timers,
      storage: store,
      wallClock: () => 1,
    });
    await sync.load();
    for (const id of ids) sync.change(id, htmlOf(16));
    const before = draftKeys.getAll(store).length;
    sync.change('d0', htmlOf(16));
    assert({
      given: '17 changed drafts, the 17th evicts the oldest',
      should: 'stay within the 16-entry cap',
      actual: { before, after: draftKeys.getAll(store).length },
      expected: { before: 16, after: 16 },
    });
  });
});
