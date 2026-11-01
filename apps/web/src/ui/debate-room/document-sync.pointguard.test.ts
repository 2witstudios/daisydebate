import { manualGenerations } from './document-sync.test-support';
import type { DraftStorage } from './note-draft-storage';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createDocumentSync, type DocumentsApi } from './document-sync';
import {
  createKeepaliveBudget,
  type KeepaliveBudget,
} from './keepalive-budget';
import {
  manualTimers,
  memoryStorage,
  stored,
} from './document-sync.test-support';

setupRitewayBun();

/** A manually released promise, so a save can stay in flight while typing continues. */
const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

/** Lets queued saves reach the API without advancing real time. */
const tick = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

/** A save body as the transport sees it; `keepalive` is fetch state only. */
type SentBody = {
  readonly id: string;
  readonly html: string;
  readonly expectedRevision: number;
  readonly keepalive?: boolean;
};

/** The exact UTF-8 body the browser transport sends; `keepalive` is fetch state. */
const transportBody = (body: SentBody): string =>
  JSON.stringify({
    id: body.id,
    html: body.html,
    expectedRevision: body.expectedRevision,
  });

const bodyBytes = (body: SentBody): number =>
  new TextEncoder().encode(transportBody(body)).length;

const api = (
  save: DocumentsApi['save'],
  documents: readonly string[] = ['a'],
): DocumentsApi => ({
  list: async () => documents.map((id) => stored(id, 3)),
  create: async () => stored('new'),
  save,
});

const syncOf = (
  save: DocumentsApi['save'],
  options: {
    readonly documents?: readonly string[];
    readonly storage?: DraftStorage & {
      readonly dump: () => ReadonlyMap<string, string>;
    };
    readonly onSaved?: () => void;
    readonly budget?: KeepaliveBudget;
    readonly onDraftStorageFailed?: (id: string) => void;
  } = {},
) =>
  createDocumentSync({
    nextGeneration: manualGenerations('document-sync.pointguard.test:1'),
    api: api(save, options.documents),
    roundId: 'r',
    principalId: 'p',
    onConflict: () => {},
    timers: manualTimers().timers,
    storage: options.storage ?? memoryStorage(),
    budget: options.budget ?? createKeepaliveBudget(),
    wallClock: () => 100,
    ...(options.onSaved ? { onSaved: options.onSaved } : {}),
    ...(options.onDraftStorageFailed
      ? { onDraftStorageFailed: options.onDraftStorageFailed }
      : {}),
  });

describe('the shared keepalive body budget', () => {
  test('bounds two sync owners, not each owner alone', async () => {
    const gate = deferred();
    const sent: SentBody[] = [];
    const budget = createKeepaliveBudget();
    const save = async (body: SentBody) => {
      sent.push(body);
      await gate.promise;
      return { status: 'saved' as const, revision: 4 };
    };
    const one = syncOf(save, { budget });
    const two = syncOf(save, { budget });
    await one.load();
    await two.load();
    one.change('a', 'x'.repeat(40_000));
    two.change('a', 'y'.repeat(40_000));
    const exitingOne = one.flushKeepalive();
    const exitingTwo = two.flushKeepalive();
    gate.release();
    await Promise.all([exitingOne, exitingTwo]);
    const bytes = sent.reduce((total, body) => total + bodyBytes(body), 0);
    assert({
      given: 'two room owners each leaving with a 40 KiB edit',
      should: 'send at most one body within the shared 64 KiB browser budget',
      actual: {
        requests: sent.length,
        withinBudget: bytes <= 65_536,
      },
      expected: { requests: 1, withinBudget: true },
    });
  });
});

describe('the body reserved for exit', () => {
  test('is the exact reconciled body at dispatch', async () => {
    const first = deferred();
    const second = deferred();
    const sent: {
      readonly id: string;
      readonly html: string;
      readonly expectedRevision: number;
      readonly keepalive?: boolean;
    }[] = [];
    let calls = 0;
    const later = 'z'.repeat(70_000);
    const save = async (body: {
      readonly id: string;
      readonly html: string;
      readonly expectedRevision: number;
      readonly keepalive?: boolean;
    }) => {
      sent.push(body);
      calls += 1;
      if (calls === 1) {
        await first.promise;
        return { status: 'saved' as const, revision: 4 };
      }
      await second.promise;
      return { status: 'saved' as const, revision: 5 };
    };
    const sync = syncOf(save);
    await sync.load();
    sync.change('a', 'old');
    const normal = sync.flush();
    await tick();
    sync.change('a', 'small');
    const exit = sync.flushKeepalive();
    sync.change('a', later);
    first.release();
    await tick();
    const keepalive = sent.filter((body) => body.keepalive === true);
    assert({
      given:
        'the waiting text and revision change behind an in-flight acknowledgement',
      should:
        'reserve the actual reconciled body at dispatch and decline it over budget',
      actual: {
        keepalive: keepalive.map((body) => ({
          html: body.html.length,
          expectedRevision: body.expectedRevision,
        })),
        newestRequest: sent.at(-1) && {
          html: sent.at(-1)?.html.length,
          expectedRevision: sent.at(-1)?.expectedRevision,
        },
      },
      expected: {
        keepalive: [],
        newestRequest: { html: 70_000, expectedRevision: 4 },
      },
    });
    second.release();
    await Promise.all([normal, exit]);
  });
});

describe('replacement eviction', () => {
  test('updating an existing draft keeps every other draft', async () => {
    const documents = Array.from({ length: 16 }, (_, index) => `d${index}`);
    const store = memoryStorage();
    const sync = syncOf(
      async ({ expectedRevision }) => ({
        status: 'saved' as const,
        revision: expectedRevision + 1,
      }),
      { documents, storage: store },
    );
    await sync.load();
    for (const id of documents) sync.change(id, id);
    const before = store.dump();
    sync.change('d15', 'updated');
    assert({
      given: 'sixteen durable drafts and an update to the newest one',
      should: 'replace that draft without evicting an unrelated older draft',
      actual: {
        before: before.size,
        after: store.dump().size,
        oldestStillStored: store.dump().has('daisy:round-notes:draft:p:r:d0'),
      },
      expected: { before: 16, after: 16, oldestStillStored: true },
    });
  });
});

describe('an acknowledged older edit with a newer edit waiting', () => {
  test('rebases the newer durable draft and stays unsaved', async () => {
    const first = deferred();
    const second = deferred();
    const store = memoryStorage();
    let savedEvents = 0;
    let calls = 0;
    const sync = syncOf(
      async () => {
        calls += 1;
        if (calls === 1) {
          await first.promise;
          return { status: 'saved' as const, revision: 4 };
        }
        await second.promise;
        return { status: 'saved' as const, revision: 5 };
      },
      { storage: store, onSaved: () => (savedEvents += 1) },
    );
    await sync.load();
    sync.change('a', 'A');
    const older = sync.flush();
    await tick();
    sync.change('a', 'B');
    first.release();
    await tick();
    const raw = store.dump().get('daisy:round-notes:draft:p:r:a');
    const draft = raw ? JSON.parse(raw).active : null;
    assert({
      given: 'A acknowledges at revision 4 while B is still waiting',
      should: 'store B against revision 4 without reporting the room saved',
      actual: { draft, savedEvents },
      expected: {
        draft: {
          html: 'B',
          baseRevision: 4,
          generation: 'document-sync.pointguard.test:1:2',
          savedAt: 100,
          expiresAt: 100 + 7 * 24 * 60 * 60 * 1000,
        },
        savedEvents: 0,
      },
    });
    second.release();
    await Promise.all([older]);
    await tick();
    assert({
      given: 'the rebased newer edit then acknowledges',
      should: 'clear its durable copy and report the room saved once',
      actual: {
        stored: store.dump().has('daisy:round-notes:draft:p:r:a'),
        savedEvents,
      },
      expected: { stored: false, savedEvents: 1 },
    });
  });
});

describe('a stored record outside DEC-271', () => {
  test('is not offered as a recovered draft', async () => {
    const store = memoryStorage();
    store.setItem(
      'daisy:round-notes:draft:p:r:a',
      JSON.stringify({
        recovery: {
          html: 'x'.repeat(300_000),
          baseRevision: 999,
          generation: 'recovered-0',
          savedAt: Number.MAX_SAFE_INTEGER,
          expiresAt: Number.MAX_SAFE_INTEGER,
        },
      }),
    );
    const sync = syncOf(
      async ({ expectedRevision }) => ({
        status: 'saved' as const,
        revision: expectedRevision + 1,
      }),
      { storage: store },
    );
    await sync.load();
    assert({
      given: 'a 300,000-byte record with an impossible base revision',
      should: 'reject and remove it rather than offer it as recovery',
      actual: {
        recovered:
          sync.recoveryOffers().find((offer) => offer.documentId === 'a')?.copy
            ?.html.length ?? 0,
        stored: store.dump().has('daisy:round-notes:draft:p:r:a'),
      },
      expected: { recovered: 0, stored: false },
    });
  });
});

describe('discarding an older recovery after newer typing', () => {
  test('preserves and saves the newer typed edit', async () => {
    const store = memoryStorage();
    store.setItem(
      'daisy:round-notes:draft:p:r:a',
      JSON.stringify({
        recovery: {
          html: '<p>recovered</p>',
          baseRevision: 3,
          generation: 'recovered-0',
          savedAt: 100,
          expiresAt: 100 + 7 * 24 * 60 * 60 * 1000,
        },
      }),
    );
    const sent: string[] = [];
    const sync = syncOf(
      async ({ html, expectedRevision }) => {
        sent.push(html);
        return { status: 'saved' as const, revision: expectedRevision + 1 };
      },
      { storage: store },
    );
    await sync.load();
    sync.change('a', '<p>newer typing</p>');
    sync.discardRecovered(
      'a',
      sync.recoveryOffers().find((offer) => offer.documentId === 'a')!.copy
        .generation,
    );
    await sync.flush();
    assert({
      given: 'a stale recovery choice and a newer edit typed after it',
      should: 'discard only the stale choice and save the newer edit',
      actual: [sent, store.dump().has('daisy:round-notes:draft:p:r:a')],
      expected: [['<p>newer typing</p>'], false],
    });
  });
});

describe('a storage operation that fails', () => {
  const failures = [
    'length',
    'key',
    'getItem',
    'removeItem',
    'setItem',
  ] as const;

  /** A real memory-backed storage seam with one named operation refusing. */
  const failingStorage = (
    failure: (typeof failures)[number],
  ): DraftStorage & { readonly dump: () => ReadonlyMap<string, string> } => {
    const backing = memoryStorage();
    const refuse = () => {
      throw new Error(`storage ${failure} failed`);
    };
    const target = 'daisy:round-notes:draft:p:r:a';
    if (failure === 'removeItem' || failure === 'key' || failure === 'getItem')
      backing.setItem(
        failure === 'key' ? `${target}-other` : target,
        JSON.stringify({
          recovery: {
            html: 'invalid',
            baseRevision: -1,
            generation: 'recovered-0',
            savedAt: 1,
            expiresAt: 2,
          },
        }),
      );
    return {
      getItem: (key) =>
        failure === 'getItem' ? refuse() : backing.getItem(key),
      setItem: (key, value) => {
        if (failure === 'setItem' && key === target) refuse();
        backing.setItem(key, value);
      },
      removeItem: (key) => {
        if (failure === 'removeItem') refuse();
        backing.removeItem(key);
      },
      key: (index) => (failure === 'key' ? refuse() : backing.key(index)),
      get length() {
        if (failure === 'length') refuse();
        return backing.length;
      },
      dump: () => backing.dump(),
    };
  };

  for (const failure of failures) {
    test(`keeps the online save scheduled and warns for ${failure}`, async () => {
      const warnings: string[] = [];
      const sent: string[] = [];
      const sync = syncOf(
        async ({ html, expectedRevision }) => {
          sent.push(html);
          return { status: 'saved' as const, revision: expectedRevision + 1 };
        },
        {
          storage: failingStorage(failure),
          onSaved: () => {},
          onDraftStorageFailed: (id) => warnings.push(id),
        },
      );
      await sync.load();
      warnings.length = 0;
      sync.change('a', '<p>online</p>');
      await sync.flush();
      assert({
        given: `${failure} throws while a durable draft is persisted`,
        should: 'warn truthfully and still send the online save',
        actual: { warned: warnings.includes('a'), sent },
        expected: { warned: true, sent: ['<p>online</p>'] },
      });
    });
  }

  test('preserves every unrelated draft when a quota-bound write fails', async () => {
    const documents = Array.from({ length: 17 }, (_, index) => `d${index}`);
    const backing = memoryStorage();
    for (const [index, id] of documents.slice(0, 16).entries()) {
      const savedAt = index + 1;
      backing.setItem(
        `daisy:round-notes:draft:p:r:${id}`,
        JSON.stringify({
          recovery: {
            html: id,
            baseRevision: 3,
            generation: 'recovered-0',
            savedAt,
            expiresAt: savedAt + 7 * 24 * 60 * 60 * 1000,
          },
        }),
      );
    }
    const target = 'daisy:round-notes:draft:p:r:d16';
    const warnings: string[] = [];
    const storage: DraftStorage & {
      readonly dump: () => ReadonlyMap<string, string>;
    } = {
      getItem: (key) => backing.getItem(key),
      setItem: (key, value) => {
        if (key === target) throw new Error('quota');
        backing.setItem(key, value);
      },
      removeItem: (key) => backing.removeItem(key),
      key: (index) => backing.key(index),
      get length() {
        return backing.length;
      },
      dump: () => backing.dump(),
    };
    const sent: string[] = [];
    const sync = syncOf(
      async ({ html, expectedRevision }) => {
        sent.push(html);
        return { status: 'saved' as const, revision: expectedRevision + 1 };
      },
      { documents, storage, onDraftStorageFailed: (id) => warnings.push(id) },
    );
    await sync.load();
    sync.change('d16', '<p>new</p>');
    const after = storage.dump();
    assert({
      given: 'a seventeenth draft cannot be written within the quota',
      should:
        'restore the oldest draft it tried to evict and keep every unrelated copy',
      actual: {
        d0: after.has('daisy:round-notes:draft:p:r:d0'),
        d15: after.has('daisy:round-notes:draft:p:r:d15'),
        d16: after.has(target),
        count: after.size,
      },
      expected: {
        d0: true,
        d15: true,
        d16: false,
        count: 16,
      },
    });
  });
});

describe('explicit recovery ownership', () => {
  test('leaves an offered exact-base draft unsent until Restore', async () => {
    const store = memoryStorage();
    store.setItem(
      'daisy:round-notes:draft:p:r:a',
      JSON.stringify({
        recovery: {
          html: '<p>recovery</p>',
          baseRevision: 3,
          generation: 'recovered-0',
          savedAt: 100,
          expiresAt: 100 + 7 * 24 * 60 * 60 * 1000,
        },
      }),
    );
    const sent: string[] = [];
    const sync = syncOf(
      async ({ html }) => {
        sent.push(html);
        return { status: 'saved', revision: 4 };
      },
      { storage: store },
    );
    await sync.load();
    await sync.flushKeepalive();
    assert({
      given: 'a recovered copy still awaiting an explicit choice',
      should: 'retain the offer without silently saving invisible text',
      actual: [sent, sync.recoveryOffers().length],
      expected: [[], 1],
    });
  });

  test('fences queued work and late acknowledgements after identity loss', async () => {
    const gate = deferred();
    const store = memoryStorage();
    let calls = 0;
    const sync = syncOf(
      async () => {
        calls += 1;
        await gate.promise;
        return { status: 'saved', revision: 4 };
      },
      { storage: store },
    );
    await sync.load();
    sync.change('a', 'A');
    const pending = sync.flush();
    await tick();
    sync.change('a', 'B');
    sync.dispose({ purge: true });
    gate.release();
    await pending;
    sync.change('a', 'C');
    await sync.flushKeepalive();
    assert({
      given:
        'identity loss during A with B waiting followed by a late callback',
      should:
        'erase private recovery and prevent old-owner persistence or sends',
      actual: [calls, store.dump().size],
      expected: [1, 0],
    });
  });
});

test('a refused replacement preserves its previous recovery value', async () => {
  const backing = memoryStorage();
  const documents = Array.from({ length: 16 }, (_, index) => `d${index}`);
  for (const id of documents)
    backing.setItem(
      `daisy:round-notes:draft:p:r:${id}`,
      JSON.stringify({
        recovery: {
          html: id,
          baseRevision: 3,
          generation: 'recovered-0',
          savedAt: 100,
          expiresAt: 604800100,
        },
      }),
    );
  const before = [...backing.dump()];
  const warnings: string[] = [];
  const sync = syncOf(async () => ({ status: 'saved', revision: 4 }), {
    documents,
    storage: {
      ...backing,
      get length() {
        return backing.length;
      },
      setItem: () => {
        throw new Error('quota');
      },
    },
    onDraftStorageFailed: (id) => warnings.push(id),
  });
  await sync.load();
  sync.change('d15', 'replacement');
  assert({
    given: 'a replacement write fails among sixteen existing drafts',
    should: 'preserve the prior target and every unrelated value and warn',
    actual: { records: [...backing.dump()], warned: warnings.includes('d15') },
    expected: { records: before, warned: true },
  });
});

test('one document acknowledgement cannot clear another recovery offer', async () => {
  const store = memoryStorage();
  store.setItem(
    'daisy:round-notes:draft:p:r:b',
    JSON.stringify({
      recovery: {
        html: '<p>recover B</p>',
        baseRevision: 3,
        generation: 'recovered-0',
        savedAt: 100,
        expiresAt: 604800100,
      },
    }),
  );
  let saved = 0;
  const sync = syncOf(async () => ({ status: 'saved', revision: 4 }), {
    documents: ['a', 'b'],
    storage: store,
    onSaved: () => saved++,
  });
  await sync.load();
  sync.change('a', 'A');
  await sync.flush();
  assert({
    given: 'A acknowledges while B still awaits a recovery choice',
    should: 'keep B visibly unsaved',
    actual: [
      saved,
      sync.recoveryOffers().some((offer) => offer.documentId === 'b'),
    ],
    expected: [0, true],
  });
  sync.restoreRecovered(
    'b',
    sync.recoveryOffers().find((offer) => offer.documentId === 'b')!.copy
      .generation,
  );
  await sync.flush();
  assert({
    given: 'B is explicitly restored and acknowledged',
    should: 'then report the owner saved',
    actual: [saved, sync.recoveryOffers().length],
    expected: [1, 0],
  });
});

test('discard matches the recovery generation even when newer text is identical', async () => {
  const store = memoryStorage();
  store.setItem(
    'daisy:round-notes:draft:p:r:a',
    JSON.stringify({
      recovery: {
        html: '<p>same text</p>',
        baseRevision: 3,
        generation: 'recovered-0',
        savedAt: 100,
        expiresAt: 604800100,
      },
    }),
  );
  const sent: string[] = [];
  const sync = syncOf(
    async ({ html }) => {
      sent.push(html);
      return { status: 'saved', revision: 4 };
    },
    { storage: store },
  );
  await sync.load();
  sync.change('a', '<p>same text</p>');
  sync.discardRecovered(
    'a',
    sync.recoveryOffers().find((offer) => offer.documentId === 'a')!.copy
      .generation,
  );
  const retained = store.dump().has('daisy:round-notes:draft:p:r:a');
  await sync.flush();
  assert({
    given: 'new typing has the same HTML as an older recovery offer',
    should: 'discard only that offer and retain/send the new edit generation',
    actual: [retained, sent],
    expected: [true, ['<p>same text</p>']],
  });
});

test('failed Discard removal keeps its recovery offer and warns', async () => {
  const backing = memoryStorage();
  backing.setItem(
    'daisy:round-notes:draft:p:r:a',
    JSON.stringify({
      recovery: {
        html: '<p>recover</p>',
        baseRevision: 3,
        generation: 'recovered-0',
        savedAt: 100,
        expiresAt: 604800100,
      },
    }),
  );
  const warnings: string[] = [];
  const sync = syncOf(async () => ({ status: 'saved', revision: 4 }), {
    storage: {
      ...backing,
      get length() {
        return backing.length;
      },
      removeItem: () => {
        throw new Error('denied');
      },
    },
    onDraftStorageFailed: (id) => warnings.push(id),
  });
  await sync.load();
  const discarded = sync.discardRecovered(
    'a',
    sync.recoveryOffers().find((offer) => offer.documentId === 'a')!.copy
      .generation,
  );
  assert({
    given: 'the browser refuses removal of a selected recovery copy',
    should: 'warn and retain the offer instead of claiming Discard succeeded',
    actual: [discarded, sync.recoveryOffers().length, warnings.includes('a')],
    expected: [false, 1, true],
  });
});

test('untrusted preexisting draft counts are bounded when read', async () => {
  const store = memoryStorage();
  const documents = Array.from({ length: 17 }, (_, i) => `d${i}`);
  for (const [i, id] of documents.entries())
    store.setItem(
      `daisy:round-notes:draft:p:r:${id}`,
      JSON.stringify({
        recovery: {
          html: '<p>copy</p>',
          baseRevision: 3,
          generation: 'recovered-0',
          savedAt: i + 1,
          expiresAt: i + 1 + 604800000,
        },
      }),
    );
  const sync = syncOf(async () => ({ status: 'saved', revision: 4 }), {
    storage: store,
    documents,
  });
  await sync.load();
  assert({
    given: 'seventeen preexisting valid local records',
    should: 'bound offers without silently deleting any unexpired copy',
    actual: [
      sync.recoveryOffers().length,
      store.dump().size,
      store.dump().has('daisy:round-notes:draft:p:r:d0'),
    ],
    expected: [16, 17, true],
  });
});
