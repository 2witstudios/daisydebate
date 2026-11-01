import {
  recordingSave,
  manualNoteResources,
  memoryStorage,
  stored,
} from './document-sync.test-support';

import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDocumentSync } from './document-sync';

import { newNoteCopy } from './note-draft';

setupRitewayBun();
const fixture = () => {
  const storage = memoryStorage(),
    ids = Array.from({ length: 17 }, (_, i) => `d${i}`);
  const key = (id: string) => `daisy:round-notes:draft:p:r:${id}`;
  const copy = (generation: string) =>
    newNoteCopy({ generation, html: generation, now: 100, baseRevision: 3 });
  for (const id of ids)
    storage.setItem(
      key(id),
      JSON.stringify(
        id === 'd0'
          ? { active: copy('paused'), recovery: copy('REC') }
          : { recovery: copy(id) },
      ),
    );
  const unrelated = [...storage.dump()].filter(([k]) => k !== key('d0'));
  const warnings: string[] = [],
    sent: string[] = [];
  let denied = false;
  const sync = createDocumentSync({
    ...manualNoteResources('capacity', {
      storage: {
        ...storage,
        get length() {
          return storage.length;
        },
        setItem: (key, value) => {
          if (denied) throw new Error('denied');
          storage.setItem(key, value);
        },
      },
    }),

    api: {
      list: async () => ids.map((id) => stored(id, 3)),
      create: async () => stored('new'),
      save: recordingSave(sent, { revision: 4 }),
    },
    roundId: 'r',
    principalId: 'p',
    onConflict: () => {},
    onDraftStorageFailed: (id) => {
      warnings.push(id);
    },
  });
  return {
    storage,
    sync,
    key,
    unrelated,
    warnings,
    sent,
    denyWrites: () => {
      denied = true;
    },
  };
};

test('explicit exact-copy cleanup can reduce an already overfull untrusted two-slot record', async () => {
  const { storage, sync, key, unrelated, warnings } = fixture();
  await sync.load();
  const first = sync.discardRecovered('d0', 'REC');
  const remaining = storage.getItem(key('d0'));
  const second = sync.discardRecovered('d0', 'paused');
  assert({
    given:
      '17 untrusted existing records with two copies in the selected document',
    should:
      'allow only the explicitly selected copies to be removed in sequence without deleting unrelated recovery',
    actual: [
      first,
      remaining ? Object.keys(JSON.parse(remaining)) : [],
      second,
      storage.length,
      [...storage.dump()],
      warnings.length > 0,
    ],
    expected: [true, ['active'], true, 16, unrelated, true],
  });
});

test('a failed overfull cleanup write retains both offers and online saving', async () => {
  const f = fixture();
  await f.sync.load();
  const before = [...f.storage.dump()];
  f.denyWrites();
  const discarded = f.sync.discardRecovered('d0', 'REC');
  f.sync.change('d0', 'NEW');
  await f.sync.flush();
  assert({
    given: 'the browser denies the strict-subset write of an exact Discard',
    should:
      'preserve both old copies and offers, warn truthfully and still send the new online edit',
    actual: [
      discarded,
      [...f.storage.dump()],
      f.sync
        .recoveryOffers()
        .filter((o) => o.documentId === 'd0')
        .map((o) => o.copy.generation),
      f.warnings.includes('d0'),
      f.sent,
    ],
    expected: [false, before, ['REC', 'paused'], true, ['NEW']],
  });
});
