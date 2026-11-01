import {
  overlappingNoteExit,
  loadNoteSync,
  recordingSave,
  documentApi,
  noteHtml as htmlOf,
  recoveryRecord,
  manualNoteResources,
  memoryStorage,
  stored,
} from './document-sync.test-support';

import { noteDraftKeys } from './note-draft-storage';

import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { type DocumentsApi } from './document-sync';

setupRitewayBun();

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
        recovery: {
          html: '<p>stale draft</p>',
          baseRevision: 0,
          generation: 'recovered-0',
          savedAt: now,
          expiresAt: 1 + 7 * 24 * 60 * 60 * 1000,
        },
      }),
    );
    const sync = await loadNoteSync({
      ...manualNoteResources('document-sync.durable.test:1', {
        storage: store,
        wallClock: () => now,
      }),

      api: alwaysSaving(),
      roundId: 'd',
      principalId: 'p1',
      onConflict: () => {},
    });

    const draft = sync
      .recoveryOffers()
      .find((offer) => offer.documentId === 'a')?.copy;
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

  test('discarding a loaded recovery removes it without an exit save', async () => {
    const store = memoryStorage();
    store.setItem(
      keyOf('p1', 'd', 'a'),
      recoveryRecord({
        html: '<p>recover</p>',
        baseRevision: 1,
        generation: 'recovered-0',
        savedAt: 1,
      }),
    );
    let saves = 0;
    const sync = await loadNoteSync({
      ...manualNoteResources('document-sync.durable.test:2', {
        storage: store,
        wallClock: () => 1,
      }),

      api: {
        ...alwaysSaving(),
        save: async () => {
          saves += 1;
          return { status: 'saved', revision: 2 };
        },
      },
      roundId: 'd',
      principalId: 'p1',
      onConflict: () => {},
    });

    assert({
      given: 'a valid exact-base recovery before Discard',
      should: 'actually offer the stored recovery',
      actual: [
        store.dump().has(keyOf('p1', 'd', 'a')),
        sync.recoveryOffers().length,
      ],
      expected: [true, 1],
    });
    sync.discardRecovered(
      'a',
      sync.recoveryOffers().find((offer) => offer.documentId === 'a')!.copy
        .generation,
    );
    await sync.flushKeepalive();
    assert({
      given: 'the participant discards that recovery then leaves',
      should: 'erase the record and offer without sending its HTML',
      actual: [
        store.dump().has(keyOf('p1', 'd', 'a')),
        sync.recoveryOffers().length,
        saves,
      ],
      expected: [false, 0, 0],
    });
  });
});

describe('the ordinary flush', () => {
  test('sends a oversized document, not the exit cap', async () => {
    const sent: string[] = [];
    const sync = await loadNoteSync({
      ...manualNoteResources('document-sync.durable.test:3'),

      api: documentApi(recordingSave(sent), () => [stored('a', 1)]),
      roundId: 'r',
      principalId: 'p1',
      onConflict: () => {},
    });

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
    const sync = await loadNoteSync({
      ...manualNoteResources('document-sync.durable.test:4'),

      api: documentApi(recordingSave(sent, { wait: gate }), () => [
        stored('a', 1),
        stored('b', 1),
      ]),
      roundId: 'r',
      principalId: 'p1',
      onConflict: () => {},
    });

    await overlappingNoteExit(sync, settle.resolve);
    assert({
      given:
        'A made into a 26 KiB recovery, then B typed while A was overflowing',
      should: 'not admit the second body over the 64 KiB budget',
      actual: sent.length,
      expected: 1,
    });
  });
});

describe('a bounded storage round', () => {
  test('refuses a seventeenth durable draft without evicting earlier copies', async () => {
    const store = memoryStorage();
    const ids = Array.from({ length: 17 }, (_, n) => `d${n}`);
    const sync = await loadNoteSync({
      ...manualNoteResources('document-sync.durable.test:5', {
        storage: store,
        wallClock: () => 1,
      }),

      api: alwaysSaving(ids),
      roundId: 'r',
      principalId: 'p1',
      onConflict: () => {},
    });

    for (const id of ids) sync.change(id, htmlOf(16));
    const before = noteDraftKeys(store).length;
    sync.change('d0', htmlOf(16));
    assert({
      given: '17 changed drafts and a replacement of the first',
      should: 'stay within the 16-entry cap',
      actual: {
        before,
        after: noteDraftKeys(store).length,
        first: store.getItem(keyOf('p1', 'r', 'd0')) !== null,
        overflow: store.getItem(keyOf('p1', 'r', 'd16')),
      },
      expected: { before: 16, after: 16, first: true, overflow: null },
    });
  });
});
