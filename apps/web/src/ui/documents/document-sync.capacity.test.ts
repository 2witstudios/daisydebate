import {
  createDocumentSync,
  listed,
  manualTimers,
  recordingSave,
  manualDraftResources,
  memoryStorage,
  stored,
} from './document-sync.test-support';

import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

import { newDraftCopy } from '../../features/documents/document-draft';

setupRitewayBun();
const fixture = () => {
  const storage = memoryStorage(),
    ids = Array.from({ length: 17 }, (_, i) => `d${i}`);
  const key = (id: string) => `daisy:document-drafts:copy:p:${id}`;
  const copy = (generation: string) =>
    newDraftCopy({ generation, html: generation, now: 100, baseRevision: 3 });
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
    ...manualDraftResources('capacity', {
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
      ...listed(() => ids.map((id) => stored(id, 3))),
      create: async () => stored('new'),
      save: recordingSave(sent, { revision: 4 }),
    },
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
    expected: [true, ['active'], true, 16, unrelated, false],
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

describe('a save the documents lane refuses (ADR 0111)', () => {
  test('stays in draft recovery and retries', async () => {
    const storage = memoryStorage();
    const clock = manualTimers();
    const sent: string[] = [];
    let refuse = true;
    const failures: number[] = [];
    const sync = createDocumentSync({
      ...manualDraftResources('capacity-lane', {
        storage,
        timers: clock.timers,
      }),
      api: {
        ...listed(() => [stored('a', 1)]),
        create: async () => stored('new'),
        save: async ({ html, expectedRevision }) => {
          sent.push(html);
          if (refuse)
            throw Object.assign(new Error('saturated'), { status: 503 });
          return { status: 'saved', revision: expectedRevision + 1 };
        },
      },
      principalId: 'p',
      onConflict: () => {},
      onSaveFailed: (_, attempts) => failures.push(attempts),
    });
    await sync.load();
    sync.change('a', '<p>typed under load</p>');
    await sync.flush();
    const held = storage.getItem('daisy:document-drafts:copy:p:a');
    refuse = false;
    await sync.flush();
    assert({
      given: 'a save refused for capacity, then the lane clearing',
      should:
        'keep the text in draft storage, count one failure, and send it again until it lands',
      actual: {
        kept: held?.includes('typed under load'),
        failures,
        sends: sent.length,
        afterwards: storage.getItem('daisy:document-drafts:copy:p:a'),
      },
      expected: { kept: true, failures: [1], sends: 2, afterwards: null },
    });
  });
});
