import {
  documentApi,
  memoryStorage,
  manualTimers,
  stored,
} from './document-sync.test-support';

import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createDocumentSync,
  type DocumentSync,
  type DocumentsApi,
} from './document-sync';

import { createKeepaliveBudget } from './keepalive-budget';
import { newNoteCopy } from './note-draft';
setupRitewayBun();
const key = 'daisy:round-notes:draft:p:r:a';
const fixture = () => {
  const storage = memoryStorage();
  let now = 100,
    generation = 0;
  let server = { ...stored('a', 3), html: '<p>SERVER</p>' };
  const writes: { html: string; expectedRevision: number }[] = [];
  const api: DocumentsApi = documentApi(
    async (input) => {
      writes.push(input);
      if (input.expectedRevision !== server.revision)
        return { status: 'conflict', revision: server.revision };
      server = { ...server, html: input.html, revision: server.revision + 1 };
      return { status: 'saved', revision: server.revision };
    },
    () => [server],
  );
  const recovery = newNoteCopy({
    html: '<p>REC</p>',
    generation: 'REC',
    baseRevision: 2,
    now,
  });
  storage.setItem(key, JSON.stringify({ recovery }));
  const owner = (
    overrides: Partial<Parameters<typeof createDocumentSync>[0]> = {},
  ) =>
    createDocumentSync({
      api,
      storage,
      roundId: 'r',
      principalId: 'p',
      timers: manualTimers().timers,
      budget: createKeepaliveBudget(),
      wallClock: () => now,
      nextGeneration: () => `edit-${++generation}`,
      onConflict: () => {},
      ...overrides,
    });
  return {
    storage,
    owner,
    recovery,
    writes,
    server: () => server,
    advance: (time: number) => {
      now = time;
    },
  };
};

for (const reload of [false, true])
  test(`REC survives NEW acknowledgement and explicit Restore CAS${reload ? ' after reload' : ''}`, async () => {
    const f = fixture();
    let sync = f.owner();
    await sync.load();
    sync.change('a', '<p>NEW</p>');
    await sync.flush();
    assert({
      given: 'NEW acknowledged while REC is offered',
      should: 'retain the original durable offer independently',
      actual: [
        JSON.parse(f.storage.getItem(key)!),
        sync.recoveryOffers().map((o) => o.copy),
      ],
      expected: [{ recovery: f.recovery }, [f.recovery]],
    });
    if (reload) {
      sync.dispose();
      sync = f.owner();
      await sync.load();
    }
    const html = sync.restoreRecovered('a', 'REC');
    assert({
      given: 'Restore accepted durably before its CAS',
      should: 'leave NEW on the server until the ordinary save succeeds',
      actual: [html, f.server().html, sync.recoveryOffers().length],
      expected: ['<p>REC</p>', '<p>NEW</p>', 0],
    });
    await sync.flush();
    assert({
      given: 'the explicit restored edit saves',
      should: 'CAS against the NEW acknowledgement and consume only REC',
      actual: [
        f.writes.map((w) => [w.html, w.expectedRevision]),
        f.server().html,
        f.storage.getItem(key),
      ],
      expected: [
        [
          ['<p>NEW</p>', 3],
          ['<p>REC</p>', 4],
        ],
        '<p>REC</p>',
        null,
      ],
    });
  });

test('Restore atomically swaps a different pending NEW into recovery and stale actions cannot consume it', async () => {
  const f = fixture(),
    sync = f.owner();
  await sync.load();
  f.advance(200);
  sync.change('a', '<p>NEW</p>');
  const active = JSON.parse(f.storage.getItem(key)!).active;
  const restored = sync.restoreRecovered('a', 'REC');
  const offer = sync.recoveryOffers()[0]!;
  const staleRestore = sync.restoreRecovered('a', 'REC'),
    staleDiscard = sync.discardRecovered('a', 'REC');
  await sync.flush();
  assert({
    given: 'REC restored over unsaved NEW followed by stale REC actions',
    should:
      'save REC and retain NEW with its exact identity and original expiry',
    actual: [
      restored,
      staleRestore,
      staleDiscard,
      offer.copy,
      JSON.parse(f.storage.getItem(key)!),
      f.server().html,
    ],
    expected: [
      '<p>REC</p>',
      null,
      false,
      active,
      { recovery: active },
      '<p>REC</p>',
    ],
  });
});

for (const failure of ['denied', 'overflow'] as const)
  test(`a ${failure} transition preserves REC while NEW can save online`, async () => {
    const f = fixture();
    const warnings: string[] = [];
    const storage =
      failure === 'denied'
        ? {
            ...f.storage,
            get length() {
              return f.storage.length;
            },
            setItem: () => {
              throw new Error('denied');
            },
          }
        : f.storage;
    const sync = f.owner({
      storage,
      onDraftStorageFailed: (id) => {
        warnings.push(id);
      },
    });
    await sync.load();
    const html =
      failure === 'overflow'
        ? `<p>${'x'.repeat(256 * 1024)}</p>`
        : '<p>NEW</p>';
    sync.change('a', html);
    const refusedRestore = sync.restoreRecovered('a', 'REC');
    await sync.flush();
    assert({
      given: 'NEW cannot join the combined durable record',
      should:
        'retain REC, refuse a destructive Restore and keep NEW in the online save path with a warning',
      actual: [
        refusedRestore,
        JSON.parse(f.storage.getItem(key)!),
        f.server().html === html,
        warnings.length > 0,
      ],
      expected: [null, { recovery: f.recovery }, true, true],
    });
  });

test('independent expiry removes only REC and account purge withdraws remaining offers', async () => {
  const f = fixture(),
    sync = f.owner();
  await sync.load();
  f.advance(200);
  sync.change('a', '<p>NEW</p>');
  sync.restoreRecovered('a', 'REC');
  f.advance(f.recovery.expiresAt);
  sync.refreshRecovery();
  assert({
    given: 'REC reaches its original expiry after swapping NEW',
    should: 'retain only the later NEW recovery',
    actual: [
      JSON.parse(f.storage.getItem(key)!).active,
      sync.recoveryOffers().map((o) => o.copy.html),
    ],
    expected: [undefined, ['<p>NEW</p>']],
  });
  sync.dispose({ purge: true });
  assert({
    given: 'account lifetime ends',
    should: 'purge both slots and the canonical UI projection',
    actual: [
      f.storage.getItem(key),
      sync.recoveryOffers().length,
      sync.available(),
    ],
    expected: [null, 0, false],
  });
});

const restorePendingNew = async (sync: DocumentSync) => {
  await sync.load();
  sync.change('a', '<p>NEW</p>');
  sync.restoreRecovered('a', 'REC');
  await sync.flush();
};

test('a remote CAS conflict preserves both swapped copies and reports the conflict', async () => {
  const f = fixture();
  let conflicts = 0;
  const sync = f.owner({
    api: documentApi(
      async () => ({ status: 'conflict', revision: 4 }),
      () => [stored('a', 3)],
    ),
    onConflict: () => {
      conflicts++;
    },
  });
  await restorePendingNew(sync);
  const record = JSON.parse(f.storage.getItem(key)!);
  assert({
    given: 'remote state advanced before the restored edit CAS',
    should:
      'retain restored active and swapped recovery without claiming success',
    actual: [
      record.active.html,
      record.active.baseRevision,
      record.recovery.html,
      conflicts,
    ],
    expected: ['<p>REC</p>', 3, '<p>NEW</p>', 1],
  });
});

test('a restored edit with an unknown acknowledgement reconciles its own commit without consuming recovery', async () => {
  const f = fixture();
  let server = stored('a', 3),
    requests = 0,
    conflicts = 0;
  const sync = f.owner({
    api: documentApi(
      async (input) => {
        requests++;
        if (requests === 1) {
          server = { ...server, html: input.html, revision: 4 };
          throw new Error('lost response');
        }
        return { status: 'conflict', revision: 4 };
      },
      () => [server],
    ),
    onConflict: () => {
      conflicts++;
    },
  });
  await restorePendingNew(sync);
  await sync.flush();
  const record = JSON.parse(f.storage.getItem(key)!);
  assert({
    given: 'the server committed restored REC but its acknowledgement was lost',
    should:
      'recognize the exact own commit and retain the independent NEW recovery',
    actual: [
      requests,
      conflicts,
      server.html,
      record.active,
      record.recovery.html,
      sync.recoveryOffers().map((o) => o.copy.html),
    ],
    expected: [2, 0, '<p>REC</p>', undefined, '<p>NEW</p>', ['<p>NEW</p>']],
  });
});
