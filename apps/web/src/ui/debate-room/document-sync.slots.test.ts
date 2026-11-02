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

test('an offer compares against the server copy, never unsaved editor text', async () => {
  const f = fixture();
  const sync = f.owner();
  let notified = 0;
  sync.subscribe(() => {
    notified += 1;
  });
  await sync.load();
  const serverCopy = () => sync.recoveryOffers()[0]!.serverHtml;
  const loaded = serverCopy();
  sync.change('a', '<p>NEW</p>');
  const whileUnsaved = serverCopy();
  const beforeAcknowledgement = notified;
  await sync.flush();
  assert({
    given: 'an offered copy, then newer typing that is acknowledged',
    should:
      'show the loaded server text until the acknowledgement, then notify with the saved text',
    actual: [
      loaded,
      whileUnsaved,
      serverCopy(),
      notified > beforeAcknowledgement,
    ],
    expected: ['<p>SERVER</p>', '<p>SERVER</p>', '<p>NEW</p>', true],
  });
});

test('a copy identical to the server text is not offered as recoverable', async () => {
  const f = fixture();
  const sameAsServer = newNoteCopy({
    html: '<p>SERVER</p>',
    generation: 'EXIT',
    baseRevision: 2,
    now: 100,
  });
  f.storage.setItem(key, JSON.stringify({ active: sameAsServer }));
  const sync = f.owner();
  await sync.load();
  assert({
    given: 'an exit save that committed although its page never saw the answer',
    should:
      'clear the durable copy and offer nothing, since nothing is at risk',
    actual: [f.storage.getItem(key), sync.recoveryOffers()],
    expected: [null, []],
  });
});

test('load keeps only the copy that differs from the server text', async () => {
  const f = fixture();
  const sameAsServer = newNoteCopy({
    html: '<p>SERVER</p>',
    generation: 'EXIT',
    baseRevision: 2,
    now: 100,
  });
  f.storage.setItem(
    key,
    JSON.stringify({ active: sameAsServer, recovery: f.recovery }),
  );
  const sync = f.owner();
  await sync.load();
  assert({
    given: 'a matching active copy beside a different recovery copy',
    should: 'keep the different copy byte for byte and still offer it',
    actual: [
      JSON.parse(f.storage.getItem(key)!),
      sync.recoveryOffers().map((offer) => offer.copy),
    ],
    expected: [{ recovery: f.recovery }, [f.recovery]],
  });
});

test('a save the server committed under a later unanswered request is not a false conflict', async () => {
  const f = fixture();
  const conflicts: string[] = [];
  let server = { ...stored('a', 3), html: '<p>SERVER</p>' };
  let attempt = 0;
  const api: DocumentsApi = documentApi(
    async (input) => {
      attempt += 1;
      if (attempt === 1) throw new Error('first request never arrived');
      if (input.expectedRevision !== server.revision)
        return { status: 'conflict', revision: server.revision };
      server = { ...server, html: input.html, revision: server.revision + 1 };
      if (attempt === 2) throw new Error('second answer lost after commit');
      return { status: 'saved', revision: server.revision };
    },
    () => [server],
  );
  const sync = f.owner({ api, onConflict: (id) => conflicts.push(id) });
  await sync.load();
  sync.change('a', '<p>A</p>');
  await sync.flush();
  sync.change('a', '<p>B</p>');
  await sync.flush();
  await sync.flush();
  assert({
    given: 'A never arrives, then B commits but its answer is lost',
    should: "recognize B as this owner's own commit, not another tab",
    actual: [conflicts, server.html, server.revision],
    expected: [[], '<p>B</p>', 4],
  });
});

test('conflict state stays true through typing, Discard and Restore', async () => {
  const f = fixture();
  const events: string[] = [];
  let server = { ...stored('a', 3), html: '<p>SERVER</p>' };
  const sent: { html: string; expectedRevision: number }[] = [];
  const api: DocumentsApi = documentApi(
    async (input) => {
      sent.push({ html: input.html, expectedRevision: input.expectedRevision });
      if (input.expectedRevision !== server.revision)
        return { status: 'conflict', revision: server.revision };
      server = { ...server, html: input.html, revision: server.revision + 1 };
      return { status: 'saved', revision: server.revision };
    },
    () => [server],
  );
  const sync = f.owner({
    api,
    onConflict: () => events.push('conflict'),
    onChanged: () => events.push('saving'),
    onSaved: () => events.push('saved'),
  });
  await sync.load();
  server = { ...server, html: '<p>THEIRS</p>', revision: 4 };
  sync.change('a', '<p>MINE</p>');
  await sync.flush();
  const sentAtConflict = sent.length;
  events.length = 0;
  sync.change('a', '<p>MINE MORE</p>');
  await sync.flush();
  const afterTyping = [...events];
  const serverCopy = sync.recoveryOffers()[0]?.serverHtml;
  const html = sync.restoreRecovered('a', 'REC');
  await sync.flush();
  assert({
    given:
      'another tab saved, this tab conflicted, then typed and pressed Restore',
    should:
      'never claim saving, send nothing while conflicted, and let Restore save on the fresh revision',
    actual: [
      afterTyping.includes('saving'),
      sent.length - sentAtConflict > 0 && sent[sentAtConflict]?.html,
      serverCopy,
      html,
      server.html,
      server.revision,
    ],
    expected: [
      false,
      '<p>REC</p>',
      '<p>THEIRS</p>',
      '<p>REC</p>',
      '<p>REC</p>',
      5,
    ],
  });
});

test('the status clears when the last offer goes away in another tab', async () => {
  const f = fixture();
  const saved: string[] = [];
  const sync = f.owner({ onSaved: (id) => saved.push(id) });
  await sync.load();
  f.storage.removeItem(key);
  sync.refreshRecovery();
  assert({
    given: 'the only offer was discarded elsewhere and nothing is pending',
    should: 'report the room saved rather than keep promising a draft below',
    actual: [sync.recoveryOffers().length, saved.length > 0],
    expected: [0, true],
  });
});

test('a corrupt record for one file does not block another file from Saved', async () => {
  const f = fixture();
  const saved: string[] = [];
  f.storage.setItem(key, '{malformed');
  const documents = [stored('a', 3), stored('b', 3)];
  const sync = f.owner({
    api: documentApi(
      async ({ expectedRevision }) => ({
        status: 'saved',
        revision: expectedRevision + 1,
      }),
      () => documents,
    ),
    onSaved: (id) => saved.push(id),
  });
  await sync.load();
  sync.change('b', '<p>NEW</p>');
  await sync.flush();
  assert({
    given: 'file a has a corrupt record discarded at load, then file b saves',
    should: 'discard the record and report file b Saved',
    actual: [f.storage.getItem(key), saved],
    expected: [null, ['b']],
  });
});

const lateCommitFixture = async () => {
  const f = fixture();
  const clock = manualTimers();
  const late = newNoteCopy({
    html: '<p>EXIT</p>',
    generation: 'EXIT',
    baseRevision: 3,
    now: 100,
  });
  f.storage.setItem(key, JSON.stringify({ active: late }));
  let server = { ...stored('a', 3), html: '<p>SERVER</p>' };
  const sent: { html: string; expectedRevision: number }[] = [];
  const events: string[] = [];
  let lists = 0;
  const api: DocumentsApi = {
    ...documentApi(
      async ({ html, expectedRevision }) => {
        sent.push({ html, expectedRevision });
        return { status: 'conflict', revision: server.revision };
      },
      () => [server],
    ),
    list: async () => {
      lists += 1;
      return [server];
    },
  };
  const sync = f.owner({
    api,
    timers: clock.timers,
    onConflict: () => events.push('conflict'),
    onSaved: () => events.push('saved'),
  });
  await sync.load();
  return {
    ...f,
    clock,
    sync,
    sent,
    events,
    lists: () => lists,
    commit: () => {
      server = { ...server, html: '<p>EXIT</p>', revision: 4 };
    },
  };
};
const settled = () => new Promise((resolve) => setImmediate(resolve));

test('a late exit commit withdraws its offer and can never be overwritten', async () => {
  const f = await lateCommitFixture();
  const before = f.sync.recoveryOffers().length;
  f.commit();
  f.clock.fire();
  await settled();
  const withdrawn = [f.sync.recoveryOffers().length, f.storage.getItem(key)];
  f.sync.change('a', '<p>SERVER plus typing</p>');
  f.clock.fire();
  await f.sync.flush();
  assert({
    given:
      'an exit save committing after this page listed, then typing on the older editor text',
    should:
      'withdraw the offer, report the conflict rather than Saved, and send nothing over it',
    actual: [
      before,
      withdrawn,
      f.events.includes('saved'),
      f.events.at(-1),
      f.sent,
    ],
    expected: [1, [0, null], false, 'conflict', []],
  });
});

test('disposing cancels the late commit recheck', async () => {
  const f = await lateCommitFixture();
  const lists = f.lists();
  f.sync.dispose();
  f.clock.fire();
  await settled();
  assert({
    given: 'an owner ended before its recheck ran',
    should: 'send no further request',
    actual: f.lists(),
    expected: lists,
  });
});

test('a list failing during a 409 is retried, not reported as a conflict', async () => {
  const f = fixture();
  const conflicts: string[] = [];
  const clock = manualTimers();
  let server = { ...stored('a', 3), html: '<p>SERVER</p>' };
  let saves = 0;
  let failList = false;
  const api: DocumentsApi = {
    ...documentApi(
      async (input) => {
        saves += 1;
        if (saves === 1) {
          server = { ...server, html: input.html, revision: 4 };
          failList = true;
          throw new Error('answer lost after commit');
        }
        return { status: 'conflict', revision: server.revision };
      },
      () => [server],
    ),
    list: async () => {
      if (failList) {
        failList = false;
        throw new Error('list failed on the same bad network');
      }
      return [server];
    },
  };
  const sync = f.owner({
    api,
    timers: clock.timers,
    onConflict: (id) => conflicts.push(id),
  });
  await sync.load();
  sync.discardRecovered('a', 'REC');
  sync.change('a', '<p>MINE</p>');
  await sync.flush();
  await sync.flush();
  const afterFailedList = [...conflicts];
  await sync.flush();
  assert({
    given: 'a commit with a lost answer, then a 409 whose list also fails',
    should: 'establish nothing, then recognize the own commit on retry',
    actual: [afterFailedList, conflicts, saves],
    expected: [[], [], 3],
  });
});

test('retries of one edit cannot evict the save that really committed', async () => {
  const f = fixture();
  const conflicts: string[] = [];
  let server = { ...stored('a', 3), html: '<p>SERVER</p>' };
  let outage = true;
  let saves = 0;
  const api: DocumentsApi = documentApi(
    async (input) => {
      saves += 1;
      if (saves === 1) {
        server = { ...server, html: input.html, revision: 4 };
        throw new Error('answer lost after commit');
      }
      if (outage) throw new Error('offline');
      return input.expectedRevision === server.revision
        ? { status: 'saved', revision: server.revision + 1 }
        : { status: 'conflict', revision: server.revision };
    },
    () => [server],
  );
  const sync = f.owner({ api, onConflict: (id) => conflicts.push(id) });
  await sync.load();
  sync.change('a', '<p>A</p>');
  await sync.flush();
  sync.change('a', '<p>B</p>');
  for (let i = 0; i < 12; i++) await sync.flush();
  outage = false;
  await sync.flush();
  await sync.flush();
  assert({
    given:
      'A commits unanswered, then B retries twelve times through an outage',
    should:
      'still recognize A as this owner, so no false conflict stops saving',
    actual: conflicts,
    expected: [],
  });
});

test('fencing never destroys text that has no stored copy', async () => {
  const f = fixture();
  const storedOwner = f.owner();
  await storedOwner.load();
  storedOwner.change('a', '<p>durable</p>');
  const unstoredOwner = f.owner({ storage: null, nextGeneration: () => 'x' });
  await unstoredOwner.load();
  unstoredOwner.change('a', '<p>memory only</p>');
  assert({
    given: 'one owner whose text is stored and one whose text is not',
    should: 'hide the first and keep the second on screen',
    actual: [
      storedOwner.fence(),
      storedOwner.closedBy(),
      unstoredOwner.fence(),
      unstoredOwner.available(),
    ],
    expected: [true, 'fence', false, true],
  });
});

test('an earlier edit another tab moved aside does not survive its replacement saving', async () => {
  const f = fixture();
  f.storage.removeItem(key);
  const sync = f.owner();
  await sync.load();
  sync.change('a', '<p>A1</p>');
  const other = f.owner({ nextGeneration: () => 'other' });
  await other.load();
  sync.change('a', '<p>A2</p>');
  await sync.flush();
  assert({
    given: 'a second tab moved A1 to recovery before A2 replaced and saved it',
    should: 'leave no superseded offer behind',
    actual: [f.server().html, f.storage.getItem(key), sync.recoveryOffers()],
    expected: ['<p>A2</p>', null, []],
  });
});

test('a new offer does not overwrite a conflict notice', async () => {
  const f = fixture();
  const events: string[] = [];
  let server = { ...stored('a', 3), html: '<p>SERVER</p>' };
  const sync = f.owner({
    api: documentApi(
      async () => ({ status: 'conflict', revision: 9 }),
      () => [server],
    ),
    onConflict: () => events.push('conflict'),
    onRecoveryChanged: () => events.push('recovered'),
  });
  await sync.load();
  sync.discardRecovered('a', 'REC');
  server = { ...server, revision: 9 };
  sync.change('a', '<p>MINE</p>');
  await sync.flush();
  f.storage.setItem(key, JSON.stringify({ recovery: f.recovery }));
  sync.refreshRecovery();
  assert({
    given: 'a conflicted document when another tab adds an offer',
    should: 'keep the conflict as the last status',
    actual: [sync.recoveryOffers().length, events.at(-1)],
    expected: [1, 'conflict'],
  });
});

test('a far-future expiry is capped to a valid timer delay', async () => {
  const f = fixture();
  const delays: number[] = [];
  const far = newNoteCopy({
    html: '<p>FAR</p>',
    generation: 'FAR',
    baseRevision: 3,
    now: 100 + 30 * 24 * 60 * 60 * 1000,
  });
  f.storage.setItem(key, JSON.stringify({ recovery: far }));
  const sync = f.owner({
    timers: {
      set: (_run, ms) => {
        delays.push(ms);
        return delays.length;
      },
      clear: () => {},
    },
  });
  await sync.load();
  assert({
    given: 'a copy expiring more than 24.8 days ahead of this clock',
    should: 'never ask for a delay browsers treat as zero',
    actual: delays.every((ms) => ms <= 2 ** 31 - 1),
    expected: true,
  });
});
